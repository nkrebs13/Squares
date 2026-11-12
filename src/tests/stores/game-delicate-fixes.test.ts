import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquaresBatchOptimistic,
	subscribeToParty,
	party,
	squares,
	pendingOperations,
	selectedPlayerFilter,
	activePlayerFilter,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import {
	mockSupabaseClient,
	mockSupabaseChannel,
	mockChannelHandlers,
	simulateChannelStatusAt,
	subscribeCallbackCount,
} from '../setup';
import {
	createEmptyGrid,
	createMockParty,
	createMockSquare,
	mockThenable,
	mockDeferredThenable,
} from '../factories';

/** Make the RPC's non-blocking .then() fire immediately with the given result. */
function rpcResolvesWith(result: { data?: unknown; error?: unknown }) {
	mockSupabaseClient.rpc.mockReturnValue(mockThenable(result));
}

/** Capture the RPC's .then() callback so the test can resolve it later, simulating
 *  an in-flight window during which the user can act. */
function rpcDeferred() {
	const { value, resolve } = mockDeferredThenable<ReturnType<typeof mockSupabaseClient.rpc>>();
	mockSupabaseClient.rpc.mockReturnValue(value);
	return { resolve };
}

// ─────────────────────────────────────────────────────────────────────────────
// BUG 1: an intentional unsubscribe() fires CLOSED asynchronously. That CLOSED
// must NOT schedule a reconnect, or leaving a party resurrects a zombie channel.
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG 1: intentional close does not resurrect a subscription', () => {
	beforeEach(() => {
		cleanup();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('does not re-open a channel when CLOSED lands after teardown', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		const base = subscribeCallbackCount();
		const teardown = subscribeToParty('party-a');
		// Channels registered in order: [base]=broadcast, [base+1]=party.
		const idxBroadcast = base;
		const idxParty = base + 1;

		// User leaves the party — this is an INTENTIONAL close.
		teardown();

		const channelCallsBefore = mockSupabaseClient.channel.mock.calls.length;

		// Supabase now delivers the CLOSED it queued when we unsubscribed.
		simulateChannelStatusAt(idxBroadcast, 'CLOSED');
		simulateChannelStatusAt(idxParty, 'CLOSED');

		// Advance past any reconnect backoff window.
		vi.advanceTimersByTime(5000);

		// No new channel may be created: the async CLOSED must not reconnect.
		expect(mockSupabaseClient.channel.mock.calls.length).toBe(channelCallsBefore);
	});

	it('A→B nav: a late CLOSED from A does not reconnect A over B', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		const base = subscribeCallbackCount();
		subscribeToParty('party-a'); // [base]=broadcastA, [base+1]=partyA
		subscribeToParty('party-b'); // [base+2]=broadcastB, [base+3]=partyB

		// B subscribes successfully first.
		simulateChannelStatusAt(base + 2, 'SUBSCRIBED');
		simulateChannelStatusAt(base + 3, 'SUBSCRIBED');

		const channelCallsBefore = mockSupabaseClient.channel.mock.calls.length;

		// A's CLOSED arrives late (after B is live) — must be ignored.
		simulateChannelStatusAt(base, 'CLOSED');
		simulateChannelStatusAt(base + 1, 'CLOSED');
		vi.advanceTimersByTime(5000);

		expect(mockSupabaseClient.channel.mock.calls.length).toBe(channelCallsBefore);
	});

	it('still reconnects on a genuine CLOSED for the current subscription', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		const base = subscribeCallbackCount();
		subscribeToParty('party-a');

		const channelCallsBefore = mockSupabaseClient.channel.mock.calls.length;

		// Genuine transport drop on the CURRENT generation → should reconnect.
		simulateChannelStatusAt(base, 'CLOSED');
		vi.advanceTimersByTime(5000);

		expect(mockSupabaseClient.channel.mock.calls.length).toBeGreaterThan(channelCallsBefore);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 2: the internal reconnect timer replaces channelStates[key].channel
// in-place WITHOUT bumping currentGeneration. The OLD channel's async CLOSED
// therefore shares the current generation and, guarded only by generation,
// would schedule a reconnect that tears down the healthy NEW channel — endless
// churn. A per-channel instance token distinguishes old from new and rejects it.
// ─────────────────────────────────────────────────────────────────────────────
describe('FIX 2: a late CLOSED from a replaced channel does not churn the reconnected one', () => {
	beforeEach(() => {
		cleanup();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('ignores the old channel CLOSED and leaves the reconnected channel healthy', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		const base = subscribeCallbackCount();
		subscribeToParty('party-a'); // [base]=broadcastA, [base+1]=partyA
		const idxPartyA = base + 1;

		// Genuine transport error on the CURRENT party channel A → schedules reconnect.
		simulateChannelStatusAt(idxPartyA, 'CHANNEL_ERROR');
		// Advance past backoff: the timer unsubscribes A (queuing its async CLOSED)
		// and creates party channel B in its place.
		vi.advanceTimersByTime(5000);
		const idxPartyB = base + 2;

		// B subscribes successfully and resets the attempt counter.
		simulateChannelStatusAt(idxPartyB, 'SUBSCRIBED');

		const channelCallsBefore = mockSupabaseClient.channel.mock.calls.length;
		const unsubBefore = mockSupabaseChannel.unsubscribe.mock.calls.length;

		// A now delivers the CLOSED queued when the reconnect timer unsubscribed it.
		// Same generation as B → only the instance-token guard can reject it.
		simulateChannelStatusAt(idxPartyA, 'CLOSED');
		vi.advanceTimersByTime(5000);

		// No new channel created and B was not torn down: the stale callback was ignored.
		expect(mockSupabaseClient.channel.mock.calls.length).toBe(channelCallsBefore);
		expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBe(unsubBefore);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 2: a rejected unclaim (RPC returns BOOLEAN false, no error, zero rows
// changed → no postgres_changes) must self-heal every client.
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG 2: rejected unclaim self-heals', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('unclaimSquareOptimistic rolls back + broadcasts unclaim_rejected on data===false', () => {
		party.set(createMockParty());
		const claimedAt = '2024-01-01T00:00:00Z';
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: claimedAt,
			}),
		]);
		subscribeToParty('test-party-id');
		mockSupabaseChannel.send.mockClear();

		// Domain rejection: false return, NO error.
		rpcResolvesWith({ data: false, error: null });

		unclaimSquareOptimistic(0, 0);

		// Square must be restored (not left empty forever).
		const sq = get(squares)[0];
		expect(sq.player_name).toBe('Alice');
		expect(sq.player_name_lower).toBe('alice');
		expect(sq.claimed_at).toBe(claimedAt);
		expect(get(pendingOperations).has('0-0')).toBe(false);

		// An unclaim_rejected broadcast must be sent so observers restore too.
		const sent = mockSupabaseChannel.send.mock.calls.map(
			(c) => c[0] as { event: string; payload: { type?: string } }
		);
		expect(
			sent.some((m) => m.event === 'square_update' && m.payload.type === 'unclaim_rejected')
		).toBe(true);
	});

	it('unclaim_rejected handler restores a square that unclaim_intent cleared', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Bob',
				player_name_lower: 'bob',
				claimed_at: '2024-01-01T00:00:00Z',
			}),
		]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:square_update'];
		expect(handler).toBeDefined();

		handler({
			payload: {
				type: 'unclaim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'bob-client',
			},
		});
		expect(get(squares)[0].player_name).toBeNull();

		handler({
			payload: {
				type: 'unclaim_rejected',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'bob-client',
			},
		});

		const sq = get(squares)[0];
		expect(sq.player_name).toBe('Bob');
		expect(sq.player_name_lower).toBe('bob');
		expect(sq.claimed_at).toBe('2024-01-01T00:00:00Z');
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});

	it('remote unclaim_intent self-heals via timeout when no rejection arrives', () => {
		vi.useFakeTimers();
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Bob',
				player_name_lower: 'bob',
				claimed_at: '2024-01-01T00:00:00Z',
			}),
		]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:square_update'];
		handler({
			payload: {
				type: 'unclaim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'bob-client',
			},
		});

		// Optimistically cleared AND tracked as a pending op (so it can be healed).
		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(true);

		// No postgres_changes (zero rows changed) and no rejection → timeout restores it.
		vi.advanceTimersByTime(10000);

		const sq = get(squares)[0];
		expect(sq.player_name).toBe('Bob');
		expect(get(pendingOperations).has('0-0')).toBe(false);

		vi.useRealTimers();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG 3: claim_rejected must roll back ONLY the rejecting client's pending op.
// ─────────────────────────────────────────────────────────────────────────────
describe('BUG 3: claim_rejected is scoped to the rejecting client', () => {
	beforeEach(() => {
		cleanup();
	});

	it("does not roll back another client's pending preview", () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:square_update'];

		// Alice's remote claim preview.
		handler({
			payload: {
				type: 'claim_intent',
				squareKey: '0-0',
				playerName: 'Alice',
				timestamp: Date.now(),
				clientId: 'alice-client',
			},
		});
		expect(get(squares)[0].player_name).toBe('Alice');

		// Bob's rejection (different client) must NOT touch Alice's preview.
		handler({
			payload: {
				type: 'claim_rejected',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'bob-client',
			},
		});

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);
	});

	it("still rolls back the rejecting client's own preview", () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:square_update'];

		handler({
			payload: {
				type: 'claim_intent',
				squareKey: '0-0',
				playerName: 'Alice',
				timestamp: Date.now(),
				clientId: 'alice-client',
			},
		});
		handler({
			payload: {
				type: 'claim_rejected',
				squareKey: '0-0',
				playerName: 'Alice',
				timestamp: Date.now(),
				clientId: 'alice-client',
			},
		});

		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// HARDENING: single + batch claims react immediately to a domain rejection /
// short count instead of racing the winner's postgres_changes event.
// ─────────────────────────────────────────────────────────────────────────────
describe('HARDENING: claims react immediately to rejection', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('claimSquareOptimistic rolls back + broadcasts claim_rejected when the square was taken', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');
		mockSupabaseChannel.send.mockClear();

		rpcResolvesWith({
			data: { ok: true, claimed: [], taken: [{ row: 0, col: 0, player_name: 'Mallory' }] },
			error: null,
		});

		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Mallory');
		expect(get(pendingOperations).has('0-0')).toBe(false);

		const sent = mockSupabaseChannel.send.mock.calls.map(
			(c) => c[0] as { event: string; payload: { type?: string } }
		);
		expect(
			sent.some((m) => m.event === 'square_update' && m.payload.type === 'claim_rejected')
		).toBe(true);
	});

	it('a short batch shows each lost cell with its owner, without refetching', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');
		mockSupabaseClient.rpc.mockClear();
		mockSupabaseChannel.send.mockClear();

		rpcResolvesWith({
			data: {
				ok: true,
				claimed: [{ row: 0, col: 1 }],
				taken: [{ row: 0, col: 0, player_name: 'Mallory' }],
			},
			error: null,
		});

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
		]);

		const at = (r: number, c: number) =>
			get(squares).find((s) => s.row_num === r && s.col_num === c);
		expect(at(0, 0)).toMatchObject({ player_name: 'Mallory', player_name_lower: 'mallory' });
		expect(at(0, 1)?.player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(false);
		expect(get(pendingOperations).has('0-1')).toBe(true);
		// one claim_squares call, no follow-up fetch
		expect(mockSupabaseClient.rpc).toHaveBeenCalledTimes(1);

		const rejected = mockSupabaseChannel.send.mock.calls
			.map((c) => c[0] as { payload: { type?: string; squareKey?: string } })
			.filter((m) => m.payload.type === 'claim_rejected')
			.map((m) => m.payload.squareKey);
		expect(rejected).toEqual(['0-0']);
	});

	it('a failed batch rolls every cell back and tells other tabs', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');
		mockSupabaseChannel.send.mockClear();

		rpcResolvesWith({ data: null, error: { message: 'TypeError: Failed to fetch' } });

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
		]);

		expect(get(squares).filter((s) => s.player_name)).toEqual([]);
		expect(get(pendingOperations).size).toBe(0);
		const rejected = mockSupabaseChannel.send.mock.calls
			.map((c) => c[0] as { payload: { type?: string; squareKey?: string } })
			.filter((m) => m.payload.type === 'claim_rejected')
			.map((m) => m.payload.squareKey);
		expect(rejected.sort()).toEqual(['0-0', '0-1']);
	});
});

describe('the player filter follows the squares', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	function aliceOwnsOneSquare() {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: '2024-01-01T00:00:00Z',
			}),
		]);
		subscribeToParty('test-party-id');
		selectedPlayerFilter.set('alice');
	}

	it('stops highlighting while the last square is optimistically cleared', () => {
		aliceOwnsOneSquare();
		rpcDeferred();

		unclaimSquareOptimistic(0, 0);

		expect(get(activePlayerFilter)).toBeNull();
	});

	it('highlights again when a rejected unclaim brings the square back', () => {
		aliceOwnsOneSquare();
		rpcResolvesWith({ data: false, error: null });

		unclaimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(activePlayerFilter)).toBe('alice');
	});
});
