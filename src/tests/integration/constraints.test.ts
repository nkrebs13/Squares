import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getTestClient,
	getServiceRoleClient,
	createTestParty,
	cleanupParty,
	type TestParty,
} from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient;
let service: SupabaseClient;
let party: TestParty;

beforeEach(async () => {
	client = getTestClient();
	service = getServiceRoleClient();
	party = await createTestParty(client);
});

afterEach(async () => {
	await cleanupParty(client, party.id);
});

describe('database constraints', () => {
	it('party splits must sum to 100', async () => {
		const { error } = await service.from('parties').insert({
			code: 'ZZBAD1',
			host_pin: '0000',
			event_name: 'Constraint probe',
			team_row_name: 'Row',
			team_col_name: 'Col',
			team_row_color: '#000000',
			team_col_color: '#ffffff',
			expires_at: new Date(Date.now() + 86_400_000).toISOString(),
			split_q1: 30,
			split_q2: 30,
			split_q3: 30,
			split_final: 30, // Sum = 120, violates constraint
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/split_total|check/i);
	});

	it('square row_num must be 0-9 (row=10 fails)', async () => {
		const { error } = await service.from('squares').insert({
			party_id: party.id,
			row_num: 10,
			col_num: 0,
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/check|row_num/i);
	});

	it('square (party_id, row_num, col_num) is UNIQUE', async () => {
		// The grid already has (0,0) from createTestParty
		const { error } = await service.from('squares').insert({
			party_id: party.id,
			row_num: 0,
			col_num: 0,
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/duplicate|unique|violates/i);
	});

	it('winner (party_id, quarter) is UNIQUE', async () => {
		// Insert first winner
		const { error: firstError } = await service.from('winners').insert({
			party_id: party.id,
			quarter: 'q1',
			winning_row: 0,
			winning_col: 0,
			player_name: 'Alice',
			amount: 25.0,
		});

		expect(firstError).toBeNull();

		// Insert duplicate (same party + quarter)
		const { error } = await service.from('winners').insert({
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
		const { error } = await service.from('winners').insert({
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
		const { error } = await service.from('numbers').insert({
			party_id: party.id,
			row_numbers: [0, 1, 2], // Only 3, needs 10
			col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		});

		expect(error).not.toBeNull();
		expect(error?.message).toMatch(/check|array_length/i);
	});

	// The functions validate first, so these CHECKs are the backstop for writes that
	// bypass them (operator SQL, a future function). Each must refuse on its own.
	const winner = { quarter: 'q2', winning_row: 0, winning_col: 0, player_name: 'A', amount: 1 };
	it.each([
		[
			'squares_row_num_check',
			() => service.from('squares').insert({ party_id: party.id, row_num: -1, col_num: 0 }),
		],
		[
			'squares_col_num_check',
			() => service.from('squares').insert({ party_id: party.id, row_num: 0, col_num: 10 }),
		],
		[
			'numbers_col_numbers_check',
			() =>
				service.from('numbers').insert({
					party_id: party.id,
					row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
					col_numbers: [0, 1, 2],
				}),
		],
		[
			'parties_status_check',
			() => service.from('parties').update({ status: 'archived' }).eq('id', party.id),
		],
		[
			'parties_split_final_check',
			() =>
				service
					.from('parties')
					.update({ split_q1: 35, split_q2: 35, split_q3: 40, split_final: -10 })
					.eq('id', party.id),
		],
		[
			'winners_winning_row_check',
			() => service.from('winners').insert({ ...winner, party_id: party.id, winning_row: 10 }),
		],
		[
			'winners_winning_col_check',
			() => service.from('winners').insert({ ...winner, party_id: party.id, winning_col: 10 }),
		],
	])('%s refuses a value outside it', async (constraint, write) => {
		const { error } = await write();
		expect(error?.code).toBe('23514');
		expect(error?.message).toContain(constraint);
	});
});
