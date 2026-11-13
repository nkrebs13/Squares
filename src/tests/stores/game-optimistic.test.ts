import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquaresBatchOptimistic,
	party,
	squares,
	pendingOperations,
	cleanup,
	subscribeToParty,
	selectedPlayerFilter,
	activePlayerFilter,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import { toast } from '$lib/stores/toast';
import type { PartyStatus } from '$lib/types';
import {
	mockSupabaseClient,
	mockSupabaseChannel,
	rpcDeferred,
	rpcHangs,
	rpcResolvesWith,
} from '../setup';
import {
	createEmptyGrid,
	createMockParty,
	createMockSquare,
	mockDeferredThenable,
} from '../factories';
import { applySquareUpdate } from '$lib/stores/game-pending';

const NON_FILLING_STATUSES: PartyStatus[] = ['locked', 'active', 'complete'];

function latestErrorToast(): string | undefined {
	return get(toast)
		.filter((t) => t.type === 'error')
		.at(-1)?.message;
}

/** The square keys of every broadcast of `type` sent to other tabs so far. */
function sentBroadcastKeys(type: string): string[] {
	return mockSupabaseChannel.send.mock.calls
		.map((c) => c[0] as { event: string; payload: { type?: string; squareKey?: string } })
		.filter((m) => m.event === 'square_update' && m.payload.type === type)
		.map((m) => m.payload.squareKey as string)
		.sort();
}

function squareAt(row: number, col: number) {
	return get(squares).find((s) => s.row_num === row && s.col_num === col);
}

/** A square Alice holds, as the store would carry it after a confirmed claim. */
function aliceSquare(row = 0, col = 0, claimed_at = '2024-01-01T00:00:00Z') {
	return createMockSquare(row, col, {
		player_name: 'Alice',
		player_name_lower: 'alice',
		claimed_at,
	});
}

describe('claimSquareOptimistic', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('returns early when no party loaded', () => {
		squares.set([createMockSquare(0, 0)]);
		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBeNull();
	});

	it('returns early when no user name', async () => {
		await userName.setName('');
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBeNull();
	});

	it('returns early when square is already claimed', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Bob',
				player_name_lower: 'bob',
			}),
		]);

		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Bob');
	});

	it('updates square immediately with player name', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(squares)[0].player_name_lower).toBe('alice');
	});

	it('captures correct originalState', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);

		expect(get(pendingOperations).get('0-0')?.originalState).toEqual({
			player_name: null,
			player_name_lower: null,
			claimed_at: null,
		});
	});

	it('claims a single square as a set of one', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);

		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('claim_squares', {
			p_party_id: 'test-party-id',
			p_player_name: 'Alice',
			p_cells: [{ row: 0, col: 0 }],
		});
	});

	it('sets pending operation on claim', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);

		const ops = get(pendingOperations);
		expect(ops.has('0-0')).toBe(true);
		expect(ops.get('0-0')?.type).toBe('claim');
	});

	it('claim then unclaim results in unclaimed', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Alice');

		unclaimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBeNull();
	});

	it('toasts a retry message, not "already claimed", when the RPC errors', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');
		rpcResolvesWith({ error: { message: 'Failed to fetch' } });

		claimSquareOptimistic(0, 0);

		expect(latestErrorToast()).toBe("Couldn't save that claim — try again.");
		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
		expect(sentBroadcastKeys('claim_rejected')).toEqual(['0-0']);
	});

	it('shows the owner and toasts "already claimed" when someone else got the square', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');
		rpcResolvesWith({
			data: { ok: true, claimed: [], taken: [{ row: 0, col: 0, player_name: 'Bob' }] },
		});

		claimSquareOptimistic(0, 0);

		expect(latestErrorToast()).toBe('Square already claimed');
		expect(get(squares)[0].player_name).toBe('Bob');
		expect(get(pendingOperations).size).toBe(0);
		expect(sentBroadcastKeys('claim_rejected')).toEqual(['0-0']);
	});

	it('still says "already claimed" when the winner\'s update arrived before our answer', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		const deferred = mockDeferredThenable();
		mockSupabaseClient.rpc.mockReturnValue(deferred.value);

		claimSquareOptimistic(0, 0);
		applySquareUpdate({
			...createMockSquare(0, 0),
			player_name: 'Bob',
			player_name_lower: 'bob',
		});
		deferred.resolve({
			data: { ok: true, claimed: [], taken: [{ row: 0, col: 0, player_name: 'Bob' }] },
			error: null,
		});

		expect(latestErrorToast()).toBe('Square already claimed');
		expect(get(squares)[0].player_name).toBe('Bob');
	});

	it('rolls back and says so when the grid was locked meanwhile', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcResolvesWith({ data: { ok: false, error: 'wrong_status' } });

		claimSquareOptimistic(0, 0);

		expect(latestErrorToast()).toBe('The grid is locked — squares can no longer be claimed.');
		expect(get(squares)[0].player_name).toBeNull();
	});
});

describe('unclaimSquareOptimistic', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('returns early when square is empty', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		unclaimSquareOptimistic(0, 0);
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});

	it('returns early when square belongs to another user', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Bob',
				player_name_lower: 'bob',
			}),
		]);

		unclaimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Bob');
	});

	it('clears square immediately on unclaim', () => {
		party.set(createMockParty());
		squares.set([aliceSquare()]);
		rpcHangs();

		unclaimSquareOptimistic(0, 0);

		const sq = get(squares)[0];
		expect(sq.player_name).toBeNull();
		expect(sq.player_name_lower).toBeNull();
		expect(sq.claimed_at).toBeNull();
	});

	it('sets pending operation', () => {
		party.set(createMockParty());
		squares.set([aliceSquare()]);
		rpcHangs();

		unclaimSquareOptimistic(0, 0);

		const ops = get(pendingOperations);
		expect(ops.has('0-0')).toBe(true);
		expect(ops.get('0-0')?.type).toBe('unclaim');
	});

	// A false return means zero rows changed, so no postgres_changes event follows to
	// heal anyone: the client must undo its own change and tell the other tabs.
	it.each([
		['errors', { error: { message: 'Failed to fetch' } }],
		['returns false', { data: false }],
	] as const)(
		'on rejection when the RPC %s, restores the square, the player filter, and toasts',
		(_label, result) => {
			party.set(createMockParty());
			squares.set([aliceSquare()]);
			selectedPlayerFilter.set('alice');
			subscribeToParty('test-party-id');
			rpcResolvesWith(result);

			unclaimSquareOptimistic(0, 0);

			expect(get(squares)[0]).toMatchObject({
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: '2024-01-01T00:00:00Z',
			});
			expect(get(pendingOperations).has('0-0')).toBe(false);
			expect(get(selectedPlayerFilter)).toBe('alice');
			expect(get(activePlayerFilter)).toBe('alice');
			expect(latestErrorToast()).toBe("Couldn't unclaim that square — try again.");
			expect(sentBroadcastKeys('unclaim_rejected')).toEqual(['0-0']);
		}
	);

	it('stops highlighting while the last square is optimistically cleared', () => {
		party.set(createMockParty());
		squares.set([aliceSquare()]);
		selectedPlayerFilter.set('alice');
		subscribeToParty('test-party-id');
		rpcDeferred();

		unclaimSquareOptimistic(0, 0);

		expect(get(activePlayerFilter)).toBeNull();
	});
});

describe('claimSquaresBatchOptimistic', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('does nothing when cells array is empty', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());

		claimSquaresBatchOptimistic([]);
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});

	it('filters out already claimed cells', () => {
		party.set(createMockParty());
		const grid = createEmptyGrid();
		grid[0].player_name = 'Bob';
		grid[0].player_name_lower = 'bob';
		squares.set(grid);
		rpcHangs();

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 }, // Already claimed by Bob
			{ row: 0, col: 1 }, // Available
		]);

		expect(squareAt(0, 0)?.player_name).toBe('Bob');
		expect(squareAt(0, 1)?.player_name).toBe('Alice');
	});

	it('updates all claimable squares immediately', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		rpcHangs();

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 1, col: 0 },
		]);

		for (const [row, col] of [
			[0, 0],
			[0, 1],
			[1, 0],
		]) {
			expect(squareAt(row, col)?.player_name).toBe('Alice');
		}
	});

	it('sends every claimable cell in one claim_squares call', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		rpcHangs();

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
		]);

		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('claim_squares', {
			p_party_id: 'test-party-id',
			p_player_name: 'Alice',
			p_cells: [
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
			],
		});
	});

	it('rolls back all optimistic claims when the batch RPC fails', () => {
		party.set(createMockParty());
		const grid = createEmptyGrid();
		grid[0].player_name = 'Bob';
		grid[0].player_name_lower = 'bob';
		grid[0].claimed_at = '2026-01-01T00:00:00.000Z';
		squares.set(grid);
		subscribeToParty('test-party-id');
		rpcResolvesWith({ data: null, error: { message: 'Network error' } });

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 }, // Already claimed by Bob
			{ row: 0, col: 1 },
			{ row: 1, col: 0 },
		]);

		expect(squareAt(0, 0)?.player_name).toBe('Bob');
		expect(squareAt(0, 1)?.player_name).toBeNull();
		expect(squareAt(1, 0)?.player_name).toBeNull();
		expect(get(pendingOperations).size).toBe(0);
		// Other tabs are told to drop the cells we previewed, and only those.
		expect(sentBroadcastKeys('claim_rejected')).toEqual(['0-1', '1-0']);
	});

	it('a short batch shows each lost cell with its owner, without refetching', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');
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

		expect(squareAt(0, 0)).toMatchObject({ player_name: 'Mallory', player_name_lower: 'mallory' });
		expect(squareAt(0, 1)?.player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(false);
		// The server confirmed 0-1: its op ends now, without waiting on Realtime.
		expect(get(pendingOperations).has('0-1')).toBe(false);
		// one claim_squares call, no follow-up fetch
		expect(mockSupabaseClient.rpc).toHaveBeenCalledTimes(1);
		expect(sentBroadcastKeys('claim_rejected')).toEqual(['0-0']);
	});

	it('a saved claim whose Realtime event never comes stays claimed, with no timeout error', async () => {
		vi.useFakeTimers();
		try {
			party.set(createMockParty());
			squares.set(createEmptyGrid());
			rpcResolvesWith({
				data: { ok: true, claimed: [{ row: 0, col: 1 }], taken: [] },
				error: null,
			});
			const errorsBefore = get(toast).filter((t) => t.type === 'error').length;

			claimSquareOptimistic(0, 1);
			await vi.advanceTimersByTimeAsync(15_000);

			expect(squareAt(0, 1)?.player_name).toBe('Alice');
			expect(get(pendingOperations).size).toBe(0);
			expect(get(toast).filter((t) => t.type === 'error').length).toBe(errorsBefore);
		} finally {
			vi.useRealTimers();
		}
	});

	it('does nothing when all cells are already claimed', () => {
		party.set(createMockParty());
		const grid = createEmptyGrid();
		grid[0].player_name = 'Bob';
		grid[0].player_name_lower = 'bob';
		squares.set(grid);

		claimSquaresBatchOptimistic([{ row: 0, col: 0 }]);
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});
});

describe('actions once the grid is no longer filling', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it.each(NON_FILLING_STATUSES)('claimSquareOptimistic rejects when status is %s', (status) => {
		party.set(createMockParty({ status }));
		squares.set([createMockSquare(0, 0)]);

		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBeNull();
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});

	it.each(NON_FILLING_STATUSES)('unclaimSquareOptimistic rejects when status is %s', (status) => {
		party.set(createMockParty({ status }));
		squares.set([aliceSquare()]);

		unclaimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});

	it.each(NON_FILLING_STATUSES)(
		'claimSquaresBatchOptimistic rejects when status is %s',
		(status) => {
			party.set(createMockParty({ status }));
			squares.set([createMockSquare(0, 0), createMockSquare(0, 1)]);

			claimSquaresBatchOptimistic([
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
			]);

			expect(get(squares).map((sq) => sq.player_name)).toEqual([null, null]);
			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		}
	);
});

describe('refuses to act while offline', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	// Activates the isOffline store the same way a real session does:
	// subscribeToParty() registers the window online/offline listeners, then
	// an 'offline' event flips isOffline to true. Subscribing also opens the
	// broadcast channel, so a stray broadcast would be seen.
	function goOffline() {
		subscribeToParty('test-party-id');
		window.dispatchEvent(new Event('offline'));
	}

	function expectNothingSentAndOfflineToast() {
		expect(get(pendingOperations).size).toBe(0);
		expect(mockSupabaseChannel.send).not.toHaveBeenCalled();
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		expect(get(toast).some((t) => t.type === 'error' && /offline/i.test(t.message))).toBe(true);
	}

	it('claimSquareOptimistic fails immediately when offline: no mutation, pending op, broadcast, or RPC', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		goOffline();

		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBeNull();
		expectNothingSentAndOfflineToast();
	});

	it('unclaimSquareOptimistic fails immediately when offline: no mutation, pending op, broadcast, or RPC', () => {
		party.set(createMockParty());
		squares.set([aliceSquare()]);
		goOffline();

		unclaimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');
		expectNothingSentAndOfflineToast();
	});

	it('claimSquaresBatchOptimistic fails immediately when offline: no mutation, pending ops, broadcast, or RPC', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		goOffline();

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 1, col: 1 },
		]);

		expect(squareAt(0, 0)?.player_name).toBeNull();
		expect(squareAt(1, 1)?.player_name).toBeNull();
		expectNothingSentAndOfflineToast();
	});

	it('does not block claims once back online', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		goOffline();
		window.dispatchEvent(new Event('online'));
		rpcHangs();

		claimSquareOptimistic(0, 0);

		expect(mockSupabaseClient.rpc).toHaveBeenCalled();
		expect(get(squares)[0].player_name).toBe('Alice');
	});
});
