import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
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

			expect(get(squares)[0].player_name).toBeNull();
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

			expect(get(squares)[0].player_name).toBe('Alice');
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

			expect(get(squares).map((sq) => sq.player_name)).toEqual([null, null]);
			expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
		});
	});

	// The client does not gate these on party status: the host_* RPC refuses with
	// wrong_status and the store maps that to copy and leaves state alone.
	describe('updatePayoutStructure', () => {
		it.each(NON_FILLING_STATUSES)(
			'surfaces the wrong_status refusal when status is %s',
			async (status) => {
				const original = createMockParty({ status, host_pin: '1234' });
				party.set(original);
				mockSupabaseClient.rpc.mockResolvedValue({
					data: { ok: false, error: 'wrong_status' },
					error: null,
				});

				const result = await updatePayoutStructure('1234', {
					q1: 25,
					q2: 25,
					q3: 25,
					final: 25,
				});

				expect(result).toEqual({ success: false, error: 'Grid is already locked' });
				expect(get(party)).toEqual(original);
			}
		);
	});

	describe('removePlayer', () => {
		it.each(NON_FILLING_STATUSES)(
			'surfaces the wrong_status refusal when status is %s',
			async (status) => {
				party.set(createMockParty({ status, host_pin: '1234' }));
				squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
				mockSupabaseClient.rpc.mockResolvedValue({
					data: { ok: false, error: 'wrong_status' },
					error: null,
				});

				const result = await removePlayer('1234', 'alice');

				expect(result).toEqual({
					success: false,
					removedCount: 0,
					error: 'Cannot remove players after grid is locked',
				});
				expect(get(squares)[0].player_name).toBe('Alice');
			}
		);
	});
});
