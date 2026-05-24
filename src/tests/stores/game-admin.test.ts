import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	lockParty,
	updateScore,
	updatePayoutStructure,
	removePlayer,
	deleteParty,
	party,
	squares,
	cleanup,
} from '$lib/stores/game';
import type { Party, Square } from '$lib/types';
import { mockSupabaseClient } from '../setup';

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

describe('lockParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await lockParty('1234');
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns success on RPC success with data true', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		const result = await lockParty('1234');
		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('lock_party', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
		});
	});

	it('returns error on RPC error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await lockParty('1234');
		expect(result).toEqual({
			success: false,
			error: 'Failed to lock party. Please try again.',
		});
	});

	it('returns error when data is false', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await lockParty('1234');
		expect(result).toEqual({
			success: false,
			error: 'Failed to lock - check PIN and ensure all squares are filled',
		});
	});
});

describe('updateScore', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns success for valid quarter', async () => {
		party.set(createMockParty({ status: 'active' }));
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_score', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_quarter: 'q1',
			p_row_score: 14,
			p_col_score: 7,
		});
	});

	it('handles all four quarters', async () => {
		party.set(createMockParty({ status: 'active' }));

		const quarters = ['q1', 'q2', 'q3', 'final'] as const;
		for (const q of quarters) {
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
			const result = await updateScore('1234', q, 10, 20);
			expect(result).toEqual({ success: true });
		}
	});

	it('returns error on RPC error', async () => {
		party.set(createMockParty({ status: 'active' }));
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({
			success: false,
			error: 'Failed to update score. Please try again.',
		});
	});

	it('returns error when data is false', async () => {
		party.set(createMockParty({ status: 'active' }));
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({
			success: false,
			error: 'Failed to update score - check PIN',
		});
	});
});

describe('updatePayoutStructure', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await updatePayoutStructure('1234', {
			q1: 25,
			q2: 25,
			q3: 25,
			final: 25,
		});
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns error when party is not filling', async () => {
		for (const status of ['active', 'complete', 'locked'] as const) {
			cleanup();
			party.set(createMockParty({ status }));
			const result = await updatePayoutStructure('1234', {
				q1: 25,
				q2: 25,
				q3: 25,
				final: 25,
			});
			expect(result).toEqual({ success: false, error: 'Grid is already locked' });
		}
	});

	it('returns error when PIN is wrong (server rejects)', async () => {
		party.set(createMockParty());
		// Server-side PIN validation: .from().update().eq().eq().select() returns empty data
		const mockChain = {
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						select: vi.fn().mockResolvedValue({
							data: [],
							error: null,
						}),
					}),
				}),
			}),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		const result = await updatePayoutStructure('9999', {
			q1: 25,
			q2: 25,
			q3: 25,
			final: 25,
		});
		expect(result).toEqual({ success: false, error: 'Invalid PIN' });
	});

	it('returns error when splits do not sum to 100', async () => {
		party.set(createMockParty({ host_pin: '1234' }));
		const result = await updatePayoutStructure('1234', {
			q1: 25,
			q2: 25,
			q3: 25,
			final: 20,
		});
		expect(result).toEqual({ success: false, error: 'Splits must add up to 100%' });
	});

	it('updates local state on success', async () => {
		party.set(createMockParty());
		// verifyHostPin RPC returns true
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
		// Chain: .from().update().eq().select() — returns updated row
		const mockChain = {
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					select: vi.fn().mockResolvedValue({
						data: [{ id: 'test-party-id' }],
						error: null,
					}),
				}),
			}),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		const result = await updatePayoutStructure('1234', {
			q1: 10,
			q2: 20,
			q3: 30,
			final: 40,
		});

		expect(result).toEqual({ success: true });
		const p = get(party);
		expect(p?.split_q1).toBe(10);
		expect(p?.split_q2).toBe(20);
		expect(p?.split_q3).toBe(30);
		expect(p?.split_final).toBe(40);
	});

	it('returns error on Supabase error', async () => {
		party.set(createMockParty());
		// verifyHostPin RPC returns true
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
		// Chain: .from().update().eq().select() — returns error
		const mockChain = {
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					select: vi.fn().mockResolvedValue({
						data: null,
						error: { message: 'DB error' },
					}),
				}),
			}),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		const result = await updatePayoutStructure('1234', {
			q1: 10,
			q2: 20,
			q3: 30,
			final: 40,
		});

		expect(result).toEqual({
			success: false,
			error: 'Failed to update payout structure. Please try again.',
		});
	});

	it('returns error when PIN is wrong', async () => {
		party.set(createMockParty());
		// verifyHostPin RPC returns false
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await updatePayoutStructure('9999', {
			q1: 10,
			q2: 20,
			q3: 30,
			final: 40,
		});

		expect(result).toEqual({ success: false, error: 'Invalid PIN' });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('verify_host_pin', {
			p_party_code: 'TEST123',
			p_pin: '9999',
		});
	});
});

describe('removePlayer', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({ success: false, removedCount: 0, error: 'No party loaded' });
	});

	it('returns error when party is not filling', async () => {
		party.set(createMockParty({ status: 'active' }));
		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'Cannot remove players after grid is locked',
		});
	});

	it('returns error when PIN is wrong (server rejects)', async () => {
		party.set(createMockParty());
		// verifyHostPin RPC returns false for wrong PIN
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await removePlayer('9999', 'alice');
		expect(result).toEqual({ success: false, removedCount: 0, error: 'Invalid PIN' });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('verify_host_pin', {
			p_party_code: 'TEST123',
			p_pin: '9999',
		});
	});

	it('removes player squares and updates local state', async () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
			createMockSquare(0, 1, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
			createMockSquare(0, 2, {
				player_name: 'Bob',
				player_name_lower: 'bob',
			}),
		]);

		// verifyHostPin RPC returns true
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		// Chain: .from().update().eq().eq().select() — select resolves with data
		const mockChain = {
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						select: vi.fn().mockResolvedValue({
							data: [{ id: 'sq-0-0' }, { id: 'sq-0-1' }],
							error: null,
						}),
					}),
				}),
			}),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		const result = await removePlayer('1234', 'alice');

		expect(result).toEqual({ success: true, removedCount: 2 });
		const currentSquares = get(squares);
		expect(currentSquares[0].player_name).toBeNull();
		expect(currentSquares[1].player_name).toBeNull();
		expect(currentSquares[2].player_name).toBe('Bob');
	});

	it('returns error on Supabase error', async () => {
		party.set(createMockParty());
		// verifyHostPin RPC returns true
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		// Chain: .from().update().eq().eq().select() — select resolves with error
		const mockChain = {
			update: vi.fn().mockReturnValue({
				eq: vi.fn().mockReturnValue({
					eq: vi.fn().mockReturnValue({
						select: vi.fn().mockResolvedValue({
							data: null,
							error: { message: 'DB error' },
						}),
					}),
				}),
			}),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'Failed to remove player. Please try again.',
		});
	});
});

describe('deleteParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await deleteParty('1234');
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns error when PIN is wrong (RPC returns false)', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await deleteParty('9999');
		expect(result).toEqual({ success: false, error: 'Invalid PIN' });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_party', {
			p_party_id: 'test-party-id',
			p_pin: '9999',
		});
	});

	it('returns success on successful delete', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		const result = await deleteParty('1234');
		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_party', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
		});
	});

	it('returns error on Supabase error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await deleteParty('1234');
		expect(result).toEqual({
			success: false,
			error: 'Failed to delete party. Please try again.',
		});
	});
});
