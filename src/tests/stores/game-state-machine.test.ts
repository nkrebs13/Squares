import { describe, it, expect, beforeEach } from 'vitest';
import {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquaresBatchOptimistic,
	claimSquare,
	claimSquaresBatch,
	unclaimSquare,
	updatePayoutStructure,
	removePlayer,
	party,
	squares,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square, PartyStatus } from '$lib/types';
import { mockSupabaseClient } from '../setup';

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

const NON_FILLING_STATUSES: PartyStatus[] = ['locked', 'active', 'complete'];

describe('State Machine: status-gated functions reject non-filling states', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	describe('claimSquareOptimistic', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', (status) => {
			party.set(createMockParty({ status }));
			squares.set([createMockSquare(0, 0)]);

			claimSquareOptimistic(0, 0);

			// Square should remain unclaimed — no Supabase call
			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	describe('unclaimSquareOptimistic', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', (status) => {
			party.set(createMockParty({ status }));
			squares.set([
				createMockSquare(0, 0, {
					player_name: 'Alice',
					player_name_lower: 'alice',
					claimed_at: new Date().toISOString(),
				}),
			]);

			unclaimSquareOptimistic(0, 0);

			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	describe('claimSquaresBatchOptimistic', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', (status) => {
			party.set(createMockParty({ status }));
			squares.set([createMockSquare(0, 0), createMockSquare(0, 1)]);

			claimSquaresBatchOptimistic([
				{ row: 0, col: 0 },
				{ row: 0, col: 1 },
			]);

			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	describe('claimSquare (legacy)', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', async (status) => {
			party.set(createMockParty({ status }));

			const result = await claimSquare(0, 0);

			expect(result).toBe(false);
			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	describe('claimSquaresBatch (legacy)', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', async (status) => {
			party.set(createMockParty({ status }));

			const result = await claimSquaresBatch([{ row: 0, col: 0 }]);

			expect(result).toBe(0);
			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	describe('unclaimSquare (legacy)', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', async (status) => {
			party.set(createMockParty({ status }));

			const result = await unclaimSquare(0, 0);

			expect(result).toBe(false);
			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	describe('updatePayoutStructure', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', async (status) => {
			party.set(createMockParty({ status, host_pin: '1234' }));

			const result = await updatePayoutStructure('1234', {
				q1: 25,
				q2: 25,
				q3: 25,
				final: 25,
			});

			expect(result.success).toBe(false);
			expect(mockSupabaseClient.from).not.toHaveBeenCalled();
		});
	});

	describe('removePlayer', () => {
		it.each(NON_FILLING_STATUSES)('rejects when status is %s', async (status) => {
			party.set(createMockParty({ status, host_pin: '1234' }));

			const result = await removePlayer('1234', 'alice');

			expect(result.success).toBe(false);
			expect(mockSupabaseClient.from).not.toHaveBeenCalled();
		});
	});

	// Positive tests: all functions should proceed when status is 'filling'
	describe('all functions proceed when status is filling', () => {
		it('claimSquare proceeds', async () => {
			party.set(createMockParty({ status: 'filling' }));
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
			const result = await claimSquare(0, 0);
			expect(result).toBe(true);
		});

		it('unclaimSquare proceeds', async () => {
			party.set(createMockParty({ status: 'filling' }));
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
			const result = await unclaimSquare(0, 0);
			expect(result).toBe(true);
		});

		it('claimSquaresBatch proceeds', async () => {
			party.set(createMockParty({ status: 'filling' }));
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 1, error: null });
			const result = await claimSquaresBatch([{ row: 0, col: 0 }]);
			expect(result).toBe(1);
		});
	});
});
