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
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square } from '$lib/types';
import {
	mockSupabaseClient,
	mockSupabaseChannel,
	mockChannelHandlers,
	simulateChannelStatusAt,
	subscribeCallbackCount,
} from '../setup';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
		event_name: 'Test Football Squares',
		kickoff_at: null,
		square_price: 10,
		split_q1: 25,
		split_q2: 25,
		split_q3: 25,
		split_final: 25,
		status: 'filling',
		team_row_name: 'Eagles',
		team_col_name: 'Chiefs',
		team_row_color: '#004C54',
		team_col_color: '#E31837',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		game_id: null,
		home_team_is_row: null,
		...overrides,
	};
}

function createMockSquare(row: number, col: number, overrides: Partial<Square> = {}): Square {
	return {
		id: `sq-${row}-${col}`,
		party_id: 'test-party-id',
		row_num: row,
		col_num: col,
		player_name: null,
		player_name_lower: null,
		claimed_at: null,
		...overrides,
	};
}

function createEmptyGrid(): Square[] {
	const grid: Square[] = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			grid.push(createMockSquare(row, col));
		}
	}
	return grid;
}

/** Make the RPC's non-blocking .then() fire immediately with the given result. */
function rpcResolvesWith(result: { data?: unknown; error?: unknown }) {
	mockSupabaseClient.rpc.mockReturnValue({
		// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		then: (cb: Function) => {
			cb(result);
			return { catch: vi.fn() };
		},
	} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);
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

	it('claimSquareOptimistic rolls back + broadcasts claim_rejected on data===false', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');
		mockSupabaseChannel.send.mockClear();

		rpcResolvesWith({ data: false, error: null });

		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);

		const sent = mockSupabaseChannel.send.mock.calls.map(
			(c) => c[0] as { event: string; payload: { type?: string } }
		);
		expect(
			sent.some((m) => m.event === 'square_update' && m.payload.type === 'claim_rejected')
		).toBe(true);
	});

	it('claimSquaresBatchOptimistic refetches on a short count and rolls back lost cells', async () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		// DB truth after the RPC: (0,0) was won by someone else, (0,1) is ours.
		const dbRows = createEmptyGrid();
		const setOwner = (r: number, c: number, name: string) => {
			const i = dbRows.findIndex((s) => s.row_num === r && s.col_num === c);
			dbRows[i] = {
				...dbRows[i],
				player_name: name,
				player_name_lower: name.toLowerCase(),
				claimed_at: '2024-01-01T00:00:00Z',
			};
		};
		setOwner(0, 0, 'Mallory');
		setOwner(0, 1, 'Alice');

		// Reconcile refetch: from('squares').select('*').eq('party_id', ...)
		mockSupabaseClient.from.mockImplementation(
			() =>
				({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockResolvedValue({ data: dbRows, error: null }),
				}) as unknown as ReturnType<typeof mockSupabaseClient.from>
		);

		// Requested 2, only 1 claimed → short count triggers reconcile.
		rpcResolvesWith({ data: 1, error: null });

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
		]);

		// Reconcile awaits the refetch — flush microtasks.
		await Promise.resolve();
		await Promise.resolve();

		const sq00 = get(squares).find((s) => s.row_num === 0 && s.col_num === 0);
		const sq01 = get(squares).find((s) => s.row_num === 0 && s.col_num === 1);

		// Lost cell rolled back to empty immediately; won cell stays ours.
		expect(sq00?.player_name).toBeNull();
		expect(sq01?.player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});
});
