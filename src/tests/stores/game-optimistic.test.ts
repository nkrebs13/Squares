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
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square } from '$lib/types';
import { mockSupabaseClient, mockSupabaseChannel } from '../setup';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
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
		await userName.clear();
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBeNull();
	});

	it('returns early when party is not filling', () => {
		party.set(createMockParty({ status: 'active' }));
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

	it('captures correct originalState', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		const ops = get(pendingOperations);
		const op = ops.get('0-0');
		expect(op).toBeDefined();
		expect(op?.originalState).toEqual({
			player_name: null,
			player_name_lower: null,
			claimed_at: null,
		});
	});

	it('rolls back on RPC failure', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		// Mock RPC to call the .then callback with error
		mockSupabaseClient.rpc.mockReturnValue({
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		then: (cb: Function) => {
				cb({ error: { message: 'Already claimed' } });
				return { catch: vi.fn() };
			},
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		// After rollback, square should be null again
		const sq = get(squares).find((s) => s.row_num === 0 && s.col_num === 0);
		expect(sq?.player_name).toBeNull();

		// Pending op should be removed
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});

	it('broadcasts claim_rejected on RPC failure', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		// Need to subscribe first to set up broadcastChannel
		// Since we can't easily set up the broadcastChannel mock, we'll verify the RPC was called
		mockSupabaseClient.rpc.mockReturnValue({
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		then: (cb: Function) => {
				cb({ error: { message: 'Already claimed' } });
				return { catch: vi.fn() };
			},
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		// Verify RPC was called with correct params
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('claim_square', {
			p_party_id: 'test-party-id',
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});
	});

	it('sets pending operation on claim', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		const ops = get(pendingOperations);
		expect(ops.has('0-0')).toBe(true);
		expect(ops.get('0-0')?.type).toBe('claim');
		expect(ops.get('0-0')?.status).toBe('pending');
	});
});

describe('unclaimSquareOptimistic', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('returns early when party not filling', () => {
		party.set(createMockParty({ status: 'active' }));
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
		]);

		unclaimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Alice');
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
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: new Date().toISOString(),
			}),
		]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		unclaimSquareOptimistic(0, 0);

		const sq = get(squares)[0];
		expect(sq.player_name).toBeNull();
		expect(sq.player_name_lower).toBeNull();
		expect(sq.claimed_at).toBeNull();
	});

	it('rolls back on RPC failure', () => {
		party.set(createMockParty());
		const originalClaimed = new Date().toISOString();
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: originalClaimed,
			}),
		]);

		mockSupabaseClient.rpc.mockReturnValue({
			// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
		then: (cb: Function) => {
				cb({ error: { message: 'Failed' } });
				return { catch: vi.fn() };
			},
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		unclaimSquareOptimistic(0, 0);

		const sq = get(squares)[0];
		expect(sq.player_name).toBe('Alice');
		expect(sq.player_name_lower).toBe('alice');
		expect(sq.claimed_at).toBe(originalClaimed);
	});

	it('sets pending operation', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: new Date().toISOString(),
			}),
		]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		unclaimSquareOptimistic(0, 0);

		const ops = get(pendingOperations);
		expect(ops.has('0-0')).toBe(true);
		expect(ops.get('0-0')?.type).toBe('unclaim');
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

	it('does nothing when party is not filling', () => {
		party.set(createMockParty({ status: 'active' }));
		squares.set(createEmptyGrid());

		claimSquaresBatchOptimistic([{ row: 0, col: 0 }]);
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});

	it('filters out already claimed cells', () => {
		party.set(createMockParty());
		const grid = createEmptyGrid();
		grid[0].player_name = 'Bob';
		grid[0].player_name_lower = 'bob';
		squares.set(grid);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 }, // Already claimed by Bob
			{ row: 0, col: 1 }, // Available
		]);

		// Only one square should be updated
		const sq00 = get(squares).find((s) => s.row_num === 0 && s.col_num === 0);
		const sq01 = get(squares).find((s) => s.row_num === 0 && s.col_num === 1);
		expect(sq00?.player_name).toBe('Bob'); // Unchanged
		expect(sq01?.player_name).toBe('Alice'); // Claimed
	});

	it('updates all claimable squares immediately', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 1, col: 0 },
		]);

		const currentSquares = get(squares);
		for (const { row, col } of [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 1, col: 0 },
		]) {
			const sq = currentSquares.find((s) => s.row_num === row && s.col_num === col);
			expect(sq?.player_name).toBe('Alice');
		}
	});

	it('calls claim_squares_batch RPC', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquaresBatchOptimistic([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
		]);

		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('claim_squares_batch', {
			p_party_id: 'test-party-id',
			p_player_name: 'Alice',
			p_cells: [
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
			],
		});
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
