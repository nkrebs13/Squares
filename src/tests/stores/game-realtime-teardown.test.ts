/**
 * Channel teardown + party-channel registration contract.
 *
 * Pins the behavior the single teardownChannels() helper must keep for all three
 * of its callers (re-subscribe, the closure subscribeToParty returns, and
 * cleanupChannels), plus the exact table/filter pairs the table-driven party
 * channel registers.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { subscribeToParty, connectionStatus, cleanup } from '$lib/stores/game';
import { broadcast } from '$lib/stores/game-realtime';
import { mockSupabaseChannel, mockSupabaseClient, simulateChannelStatus } from '../setup';

const claimIntent = {
	type: 'claim_intent' as const,
	squareKey: '1-2',
	playerName: 'Alice',
	timestamp: 1,
};

describe('party channel postgres_changes registrations', () => {
	beforeEach(() => cleanup());

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
	beforeEach(() => {
		cleanup();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

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
});
