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

describe('unclaim_square RPC', () => {
	it('unclaims an owned square and returns true', async () => {
		// First claim the square
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		// Unclaim it
		const { data } = await client.rpc('unclaim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		expect(data).toBe(true);

		// Verify square is empty
		const { data: square } = await client
			.from('squares')
			.select('player_name, claimed_at')
			.eq('party_id', party.id)
			.eq('row_num', 0)
			.eq('col_num', 0)
			.single();

		expect(square!.player_name).toBeNull();
		expect(square!.claimed_at).toBeNull();
	});

	it('rejects unclaim when name does not match', async () => {
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 1,
			p_col: 1,
			p_player_name: 'Alice',
		});

		const { data } = await client.rpc('unclaim_square', {
			p_party_id: party.id,
			p_row: 1,
			p_col: 1,
			p_player_name: 'Bob',
		});

		expect(data).toBe(false);

		// Alice still owns it
		const { data: square } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 1)
			.eq('col_num', 1)
			.single();

		expect(square!.player_name).toBe('Alice');
	});

	it('supports case-insensitive name matching', async () => {
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 2,
			p_col: 2,
			p_player_name: 'Alice',
		});

		// Unclaim with different casing
		const { data } = await client.rpc('unclaim_square', {
			p_party_id: party.id,
			p_row: 2,
			p_col: 2,
			p_player_name: 'alice',
		});

		expect(data).toBe(true);
	});

	it('rejects unclaim when party status is active', async () => {
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 3,
			p_col: 3,
			p_player_name: 'Alice',
		});

		await client.from('parties').update({ status: 'active' }).eq('id', party.id);

		const { data } = await client.rpc('unclaim_square', {
			p_party_id: party.id,
			p_row: 3,
			p_col: 3,
			p_player_name: 'Alice',
		});

		expect(data).toBe(false);
	});

	it('rejects unclaim on already-empty square', async () => {
		const { data } = await client.rpc('unclaim_square', {
			p_party_id: party.id,
			p_row: 4,
			p_col: 4,
			p_player_name: 'Alice',
		});

		expect(data).toBe(false);
	});
});
