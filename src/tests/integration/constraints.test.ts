import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTestClient, createTestParty, cleanupParty, type TestParty } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient;
let party: TestParty;

beforeEach(async () => {
	client = getTestClient();
	party = await createTestParty(client);
});

afterEach(async () => {
	await cleanupParty(client, party.id);
});

describe('database constraints', () => {
	it('party splits must sum to 100', async () => {
		const { error } = await client.from('parties').insert({
			code: 'ZZBAD1',
			host_pin: '0000',
			split_q1: 30,
			split_q2: 30,
			split_q3: 30,
			split_final: 30, // Sum = 120, violates constraint
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/split_total|check/i);
	});

	it('square row_num must be 0-9 (row=10 fails)', async () => {
		const { error } = await client.from('squares').insert({
			party_id: party.id,
			row_num: 10,
			col_num: 0,
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/check|row_num/i);
	});

	it('square (party_id, row_num, col_num) is UNIQUE', async () => {
		// The grid already has (0,0) from createTestParty
		const { error } = await client.from('squares').insert({
			party_id: party.id,
			row_num: 0,
			col_num: 0,
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/duplicate|unique|violates/i);
	});

	it('winner (party_id, quarter) is UNIQUE', async () => {
		// Insert first winner
		const { error: firstError } = await client.from('winners').insert({
			party_id: party.id,
			quarter: 'q1',
			winning_row: 0,
			winning_col: 0,
			player_name: 'Alice',
			amount: 25.0,
		});

		expect(firstError).toBeNull();

		// Insert duplicate (same party + quarter)
		const { error } = await client.from('winners').insert({
			party_id: party.id,
			quarter: 'q1',
			winning_row: 1,
			winning_col: 1,
			player_name: 'Bob',
			amount: 25.0,
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/duplicate|unique|violates/i);
	});

	it('winner quarter must be in (q1, q2, q3, final)', async () => {
		const { error } = await client.from('winners').insert({
			party_id: party.id,
			quarter: 'q5',
			winning_row: 0,
			winning_col: 0,
			player_name: 'Alice',
			amount: 25.0,
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/check|quarter/i);
	});

	it('numbers arrays must have exactly 10 elements', async () => {
		const { error } = await client.from('numbers').insert({
			party_id: party.id,
			row_numbers: [0, 1, 2], // Only 3, needs 10
			col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/check|array_length/i);
	});
});
