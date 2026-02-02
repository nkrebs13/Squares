import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getTestClient,
	createTestParty,
	fillAllSquares,
	lockParty,
	cleanupParty,
	type TestParty,
} from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient;
let party: TestParty;

/**
 * Helper: create a filled + locked party ready for scoring.
 */
async function createLockedParty(
	c: SupabaseClient,
	overrides?: { square_price?: number }
): Promise<TestParty> {
	const p = await createTestParty(c, overrides);
	await fillAllSquares(c, p.id);
	await lockParty(c, p.id, p.host_pin);
	return p;
}

beforeEach(async () => {
	client = getTestClient();
	party = await createLockedParty(client);
});

afterEach(async () => {
	await cleanupParty(client, party.id);
});

describe('update_score RPC', () => {
	it('updates Q1 score and creates winner record', async () => {
		const { data } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});

		expect(data).toBe(true);

		// Verify scores table
		const { data: scores } = await client
			.from('scores')
			.select('q1_row_score, q1_col_score')
			.eq('party_id', party.id)
			.single();

		expect(scores!.q1_row_score).toBe(7);
		expect(scores!.q1_col_score).toBe(3);

		// Verify winner was created
		const { data: winner } = await client
			.from('winners')
			.select('quarter, player_name, winning_row, winning_col')
			.eq('party_id', party.id)
			.eq('quarter', 'q1')
			.single();

		expect(winner).not.toBeNull();
		expect(winner!.player_name).toBeTruthy();
	});

	it('updates Q2 and Q3 scores', async () => {
		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q2',
			p_row_score: 14,
			p_col_score: 10,
		});

		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q3',
			p_row_score: 21,
			p_col_score: 17,
		});

		const { data: scores } = await client
			.from('scores')
			.select('q2_row_score, q2_col_score, q3_row_score, q3_col_score')
			.eq('party_id', party.id)
			.single();

		expect(scores!.q2_row_score).toBe(14);
		expect(scores!.q2_col_score).toBe(10);
		expect(scores!.q3_row_score).toBe(21);
		expect(scores!.q3_col_score).toBe(17);

		// Both quarters should have winners
		const { data: winners } = await client
			.from('winners')
			.select('quarter')
			.eq('party_id', party.id);

		const quarters = winners!.map((w) => w.quarter);
		expect(quarters).toContain('q2');
		expect(quarters).toContain('q3');
	});

	it('updates final score and sets party status to complete', async () => {
		const { data } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'final',
			p_row_score: 28,
			p_col_score: 24,
		});

		expect(data).toBe(true);

		const { data: updatedParty } = await client
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();

		expect(updatedParty!.status).toBe('complete');
	});

	it('rejects negative scores', async () => {
		const { data } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: -1,
			p_col_score: 3,
		});

		expect(data).toBe(false);
	});

	it('rejects invalid quarter string', async () => {
		const { data } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q5',
			p_row_score: 7,
			p_col_score: 3,
		});

		expect(data).toBe(false);
	});

	it('rejects wrong PIN', async () => {
		const { data } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: '9999',
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});

		expect(data).toBe(false);
	});

	it('calculates prize correctly: (square_price * 100) * split / 100', async () => {
		// Clean up default party and create one with specific price
		await cleanupParty(client, party.id);
		party = await createLockedParty(client, { square_price: 5 });

		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});

		const { data: winner } = await client
			.from('winners')
			.select('amount')
			.eq('party_id', party.id)
			.eq('quarter', 'q1')
			.single();

		// Total pot = 5 * 100 = 500, split_q1 = 25, prize = 500 * 25 / 100 = 125
		expect(Number(winner!.amount)).toBe(125);
	});

	it('re-scoring same quarter updates winner via ON CONFLICT', async () => {
		// Score Q1 first time
		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});

		const { data: first } = await client
			.from('winners')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('quarter', 'q1')
			.single();

		// Score Q1 again with different scores
		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 0,
			p_col_score: 0,
		});

		const { data: second } = await client
			.from('winners')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('quarter', 'q1')
			.single();

		// Should still have exactly one winner record (not a duplicate)
		const { data: allQ1 } = await client
			.from('winners')
			.select('id')
			.eq('party_id', party.id)
			.eq('quarter', 'q1');

		expect(allQ1).toHaveLength(1);

		// Winner name may or may not have changed depending on numbers, but record exists
		expect(second!.player_name).toBeTruthy();
		// Verify this is testing ON CONFLICT - if scores differ, the player_name or position could differ
		expect(first).not.toBeNull();
	});

	it('maps score digit through numbers array correctly', async () => {
		// Get the number assignments
		const { data: numbers } = await client
			.from('numbers')
			.select('row_numbers, col_numbers')
			.eq('party_id', party.id)
			.single();

		// Score 27 → digit 7, score 13 → digit 3
		// Find which row index maps to digit 7 and which col index maps to digit 3
		const rowIdx = numbers!.row_numbers.indexOf(7);
		const colIdx = numbers!.col_numbers.indexOf(3);

		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 27,
			p_col_score: 13,
		});

		const { data: winner } = await client
			.from('winners')
			.select('winning_row, winning_col, player_name')
			.eq('party_id', party.id)
			.eq('quarter', 'q1')
			.single();

		expect(winner!.winning_row).toBe(rowIdx);
		expect(winner!.winning_col).toBe(colIdx);

		// The player should be the one at that grid position
		expect(winner!.player_name).toBe(`Player-R${rowIdx}C${colIdx}`);
	});
});
