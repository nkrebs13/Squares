/**
 * Channel lifecycle of game-realtime: which channels subscribeToParty opens, how
 * they are torn down, and how they reconnect. What the channels deliver is in
 * game-realtime.handlers.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { subscribeToParty, connectionStatus, cleanup } from '$lib/stores/game';
import { broadcast } from '$lib/stores/game-realtime';
import {
	channelStatusCallbacks,
	mockSupabaseChannel,
	mockSupabaseClient,
	simulateChannelStatus,
} from '../setup';

const claimIntent = {
	type: 'claim_intent' as const,
	squareKey: '1-2',
	playerName: 'Alice',
	timestamp: 1,
};

/** Status callback of the nth channel (0 = first, 1 = its reconnect replacement) opened under `name`. */
function statusCallback(name: string, nth = 0) {
	const cb = channelStatusCallbacks(name)[nth];
	if (!cb) throw new Error(`channel ${name} #${nth} was never subscribed`);
	return cb;
}

function channelsCreated() {
	return mockSupabaseClient.channel.mock.calls.length;
}

beforeEach(() => {
	cleanup();
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('subscribeToParty channels', () => {
	it('creates two channels (broadcast + postgres_changes)', () => {
		subscribeToParty('test-party-id');
		// channel() called twice: once for broadcast, once for postgres_changes
		expect(mockSupabaseClient.channel).toHaveBeenCalledTimes(2);
		expect(mockSupabaseClient.channel).toHaveBeenCalledWith('party-broadcast:test-party-id');
		expect(mockSupabaseClient.channel).toHaveBeenCalledWith('party:test-party-id');
	});

	it('subscribes to broadcast events', () => {
		subscribeToParty('test-party-id');
		expect(mockSupabaseChannel.on).toHaveBeenCalledWith(
			'broadcast',
			expect.objectContaining({ event: 'square_update' }),
			expect.any(Function)
		);
	});

	it('registers the five tables with their per-table filters, in order', () => {
		subscribeToParty('p1');

		const registrations = mockSupabaseChannel.on.mock.calls
			.filter((call: unknown[]) => call[0] === 'postgres_changes')
			.map((call: unknown[]) => call[1]);

		expect(registrations).toEqual([
			{ event: '*', schema: 'public', table: 'squares', filter: 'party_id=eq.p1' },
			{ event: '*', schema: 'public', table: 'parties', filter: 'id=eq.p1' },
			{ event: '*', schema: 'public', table: 'numbers', filter: 'party_id=eq.p1' },
			{ event: '*', schema: 'public', table: 'scores', filter: 'party_id=eq.p1' },
			{ event: '*', schema: 'public', table: 'winners', filter: 'party_id=eq.p1' },
		]);
	});
});

describe('channel teardown', () => {
	it('re-subscribing unsubscribes every old channel, then sets up fresh ones that broadcast', () => {
		subscribeToParty('p1', 'g1');
		mockSupabaseChannel.unsubscribe.mockClear();
		mockSupabaseClient.channel.mockClear();

		subscribeToParty('p2', null);

		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalledTimes(3); // party, broadcast, game
		expect(mockSupabaseClient.channel.mock.calls.map((c: unknown[]) => c[0])).toEqual([
			'party-broadcast:p2',
			'party:p2',
		]);

		broadcast(claimIntent);
		expect(mockSupabaseChannel.send).toHaveBeenCalledTimes(1);
	});

	it('a CLOSED fired synchronously by unsubscribe() during re-subscribe never schedules a reconnect', () => {
		subscribeToParty('p1', 'g1');
		// Real supabase-js fires CLOSED synchronously from unsubscribe() when the
		// socket can't push; only the OLD channels' callbacks exist at that moment.
		mockSupabaseChannel.unsubscribe.mockImplementation(() => simulateChannelStatus('CLOSED'));

		subscribeToParty('p2', null);
		mockSupabaseClient.channel.mockClear();
		vi.advanceTimersByTime(60_000);

		expect(mockSupabaseClient.channel).not.toHaveBeenCalled();
		expect(get(connectionStatus)).toEqual({ status: 'connected', attempt: 0 });
	});

	it.each([
		['the subscribeToParty closure', (unsubscribe: () => void) => unsubscribe()],
		['cleanup()', () => cleanup()],
	])('%s unsubscribes every channel and leaves broadcast() a no-op', (_label, teardown) => {
		const unsubscribe = subscribeToParty('p1', 'g1');
		mockSupabaseChannel.unsubscribe.mockClear();

		teardown(unsubscribe);

		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalledTimes(3);
		broadcast(claimIntent);
		expect(mockSupabaseChannel.send).not.toHaveBeenCalled();
	});

	it.each([
		['the subscribeToParty closure', (unsubscribe: () => void) => unsubscribe()],
		['cleanup()', () => cleanup()],
	])(
		'%s unsubscribes just the party and broadcast channels when there is no game',
		(_label, teardown) => {
			const unsubscribe = subscribeToParty('p1');
			mockSupabaseChannel.unsubscribe.mockClear();

			teardown(unsubscribe);

			expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalledTimes(2);
		}
	);

	it('teardown cancels a pending reconnect and resets the connection status', () => {
		subscribeToParty('p1');
		simulateChannelStatus('CHANNEL_ERROR');
		expect(get(connectionStatus).status).toBe('reconnecting');

		cleanup();
		mockSupabaseClient.channel.mockClear();
		vi.advanceTimersByTime(60_000);

		expect(mockSupabaseClient.channel).not.toHaveBeenCalled();
		expect(get(connectionStatus)).toEqual({ status: 'connected', attempt: 0 });
	});

	it('switching parties cancels pending reconnection timeout', () => {
		subscribeToParty('test-party-id');
		simulateChannelStatus('CHANNEL_ERROR');

		// Switch to a different party before the reconnect timer fires
		subscribeToParty('other-party-id');
		mockSupabaseClient.channel.mockClear();

		// The old reconnection must not fire: it would re-create channels for the old party
		vi.advanceTimersByTime(5000);

		expect(mockSupabaseClient.channel).not.toHaveBeenCalled();
		expect(get(connectionStatus)).toEqual({ status: 'connected', attempt: 0 });
	});
});

describe('reconnecting with backoff', () => {
	it('SUBSCRIBED status resets reconnect state', () => {
		subscribeToParty('test-party-id');

		simulateChannelStatus('CHANNEL_ERROR');
		expect(get(connectionStatus)).toEqual({ status: 'reconnecting', attempt: 1 });

		simulateChannelStatus('SUBSCRIBED');

		expect(get(connectionStatus)).toEqual({ status: 'connected', attempt: 0 });
		// The pending reconnect timer was cancelled with the reset
		expect(vi.getTimerCount()).toBe(0);
	});

	it('game channel SUBSCRIBED status resets reconnect state', () => {
		subscribeToParty('test-party-id', 'game-123');
		const gameStatus = statusCallback('game:game-123');

		gameStatus('CHANNEL_ERROR');
		expect(get(connectionStatus)).toEqual({ status: 'reconnecting', attempt: 1 });

		gameStatus('SUBSCRIBED');

		expect(get(connectionStatus)).toEqual({ status: 'connected', attempt: 0 });
	});

	it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'] as const)(
		'%s triggers reconnection attempt',
		(status) => {
			subscribeToParty('test-party-id');
			const unsubscribesBefore = mockSupabaseChannel.unsubscribe.mock.calls.length;

			simulateChannelStatus(status);
			// Past the reconnection delay (1s base + jitter)
			vi.advanceTimersByTime(2000);

			// The dead channels were replaced
			expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBeGreaterThan(unsubscribesBefore);
		}
	);

	it('exponential backoff increases delay between reconnection attempts', () => {
		subscribeToParty('test-party-id');
		mockSupabaseChannel.unsubscribe.mockClear();

		// First error: reconnect after the base delay (1000ms + up to 500ms jitter)
		simulateChannelStatus('CHANNEL_ERROR');
		vi.advanceTimersByTime(999);
		expect(mockSupabaseChannel.unsubscribe).not.toHaveBeenCalled();
		vi.advanceTimersByTime(501);
		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalled();

		// Second error without an intervening SUBSCRIBED: delay doubles (2000ms + jitter)
		mockSupabaseChannel.unsubscribe.mockClear();
		simulateChannelStatus('CHANNEL_ERROR');
		vi.advanceTimersByTime(1999);
		expect(mockSupabaseChannel.unsubscribe).not.toHaveBeenCalled();
		vi.advanceTimersByTime(501);
		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalled();
	});
});

// Supabase delivers the CLOSED of an unsubscribed channel asynchronously, after we
// have already moved on. Reacting to it would resurrect a channel nobody wants.
describe('a late CLOSED from a channel we no longer use', () => {
	it('does not re-open a channel when CLOSED lands after teardown', () => {
		const teardown = subscribeToParty('party-a');
		const broadcastClosed = statusCallback('party-broadcast:party-a');
		const partyClosed = statusCallback('party:party-a');

		// User leaves the party: an INTENTIONAL close.
		teardown();
		const before = channelsCreated();

		broadcastClosed('CLOSED');
		partyClosed('CLOSED');
		vi.advanceTimersByTime(5000);

		expect(channelsCreated()).toBe(before);
	});

	it('A→B nav: a late CLOSED from A does not reconnect A over B', () => {
		subscribeToParty('party-a');
		subscribeToParty('party-b');
		statusCallback('party-broadcast:party-b')('SUBSCRIBED');
		statusCallback('party:party-b')('SUBSCRIBED');
		const before = channelsCreated();

		// A's CLOSED arrives late, after B is live.
		statusCallback('party-broadcast:party-a')('CLOSED');
		statusCallback('party:party-a')('CLOSED');
		vi.advanceTimersByTime(5000);

		expect(channelsCreated()).toBe(before);
	});

	it('still reconnects on a genuine CLOSED for the current subscription', () => {
		subscribeToParty('party-a');
		const before = channelsCreated();

		statusCallback('party-broadcast:party-a')('CLOSED');
		vi.advanceTimersByTime(5000);

		expect(channelsCreated()).toBeGreaterThan(before);
	});

	// The reconnect timer swaps in a new channel without starting a new subscription,
	// so the old channel's CLOSED carries the current subscription's generation and
	// would tear down the healthy new channel, again and again. Only the channel
	// instance tells them apart.
	it('ignores the old channel CLOSED and leaves the reconnected channel healthy', () => {
		subscribeToParty('party-a');
		const oldParty = statusCallback('party:party-a');

		// A genuine transport error on the current party channel schedules a reconnect;
		// the timer unsubscribes the old channel and opens its replacement.
		oldParty('CHANNEL_ERROR');
		vi.advanceTimersByTime(5000);
		statusCallback('party:party-a', 1)('SUBSCRIBED');

		const channelsBefore = channelsCreated();
		const unsubscribesBefore = mockSupabaseChannel.unsubscribe.mock.calls.length;

		oldParty('CLOSED');
		vi.advanceTimersByTime(5000);

		expect(channelsCreated()).toBe(channelsBefore);
		expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBe(unsubscribesBefore);
	});
});
