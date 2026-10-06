import { describe, it, expect, beforeEach } from 'vitest';
import {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquaresBatchOptimistic,
	updatePayoutStructure,
	removePlayer,
	party,
	squares,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { PartyStatus } from '$lib/types';
import { mockSupabaseClient } from '../setup';
import { createMockParty, createMockSquare } from '../factories';

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
});
