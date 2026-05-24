import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getServiceRoleClient,
	getTestClient,
	createTestParty,
	cleanupParty,
	type TestParty,
} from './helpers';
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

describe('claim_squares_batch RPC', () => {
	it('claims multiple unclaimed squares and returns count', async () => {
		const cells = [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 },
		];

		const { data } = await client.rpc('claim_squares_batch', {
			p_party_id: party.id,
			p_player_name: 'Alice',
			p_cells: cells,
		});

		expect(data).toBe(3);

		// Verify all three squares are claimed
		const { data: squares } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 0)
			.in('col_num', [0, 1, 2]);

		expect(squares).toHaveLength(3);
		squares?.forEach((s) => expect(s.player_name).toBe('Alice'));
	});

	it('skips already-claimed squares and returns partial count', async () => {
		// Claim one square first
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 1,
			p_col: 0,
			p_player_name: 'Bob',
		});

		// Batch claim that includes the already-claimed square
		const cells = [
			{ row: 1, col: 0 }, // already claimed by Bob
			{ row: 1, col: 1 },
			{ row: 1, col: 2 },
		];

		const { data } = await client.rpc('claim_squares_batch', {
			p_party_id: party.id,
			p_player_name: 'Alice',
			p_cells: cells,
		});

		expect(data).toBe(2);

		// Bob still owns (1,0)
		const { data: bobSquare } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 1)
			.eq('col_num', 0)
			.single();

		expect(bobSquare?.player_name).toBe('Bob');
	});

	it('returns 0 when party is not filling', async () => {
		await getServiceRoleClient().from('parties').update({ status: 'active' }).eq('id', party.id);

		const { data } = await client.rpc('claim_squares_batch', {
			p_party_id: party.id,
			p_player_name: 'Alice',
			p_cells: [{ row: 0, col: 0 }],
		});

		expect(data).toBe(0);
	});

	it('returns 0 when all requested cells are already claimed', async () => {
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 2,
			p_col: 0,
			p_player_name: 'Bob',
		});

		const { data } = await client.rpc('claim_squares_batch', {
			p_party_id: party.id,
			p_player_name: 'Alice',
			p_cells: [{ row: 2, col: 0 }],
		});

		expect(data).toBe(0);
	});

	it('returns 0 for empty cells array', async () => {
		const { data } = await client.rpc('claim_squares_batch', {
			p_party_id: party.id,
			p_player_name: 'Alice',
			p_cells: [],
		});

		expect(data).toBe(0);
	});
});
