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

describe('claim_square RPC', () => {
	it('claims an unclaimed square and returns true', async () => {
		const { data } = await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		expect(data).toBe(true);

		// Verify the square has the player_name set
		const { data: square } = await client
			.from('squares')
			.select('player_name, claimed_at')
			.eq('party_id', party.id)
			.eq('row_num', 0)
			.eq('col_num', 0)
			.single();

		expect(square?.player_name).toBe('Alice');
		expect(square?.claimed_at).not.toBeNull();
	});

	it('rejects claim on already-claimed square', async () => {
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 1,
			p_col: 1,
			p_player_name: 'Alice',
		});

		const { data } = await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 1,
			p_col: 1,
			p_player_name: 'Bob',
		});

		expect(data).toBe(false);

		// Verify Alice still owns it
		const { data: square } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 1)
			.eq('col_num', 1)
			.single();

		expect(square?.player_name).toBe('Alice');
	});

	it('rejects claim when party status is active', async () => {
		// Manually set status to active
		await getServiceRoleClient().from('parties').update({ status: 'active' }).eq('id', party.id);

		const { data } = await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		expect(data).toBe(false);
	});

	it('rejects claim when party status is complete', async () => {
		await getServiceRoleClient().from('parties').update({ status: 'complete' }).eq('id', party.id);

		const { data } = await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		expect(data).toBe(false);
	});

	it('rejects claim for non-existent party', async () => {
		const { data } = await client.rpc('claim_square', {
			p_party_id: '00000000-0000-0000-0000-000000000000',
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		expect(data).toBe(false);
	});

	it('auto-generates player_name_lower (case-insensitive)', async () => {
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 2,
			p_col: 3,
			p_player_name: 'Alice McName',
		});

		const { data: square } = await client
			.from('squares')
			.select('player_name, player_name_lower')
			.eq('party_id', party.id)
			.eq('row_num', 2)
			.eq('col_num', 3)
			.single();

		expect(square?.player_name).toBe('Alice McName');
		expect(square?.player_name_lower).toBe('alice mcname');
	});

	it('handles concurrent claims — exactly one succeeds', async () => {
		// Fire two claims on the same square simultaneously
		const [result1, result2] = await Promise.all([
			client.rpc('claim_square', {
				p_party_id: party.id,
				p_row: 5,
				p_col: 5,
				p_player_name: 'Alice',
			}),
			client.rpc('claim_square', {
				p_party_id: party.id,
				p_row: 5,
				p_col: 5,
				p_player_name: 'Bob',
			}),
		]);

		const successes = [result1.data, result2.data].filter(Boolean);
		expect(successes).toHaveLength(1);

		// Verify only one name is on the square
		const { data: square } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 5)
			.eq('col_num', 5)
			.single();

		expect(['Alice', 'Bob']).toContain(square?.player_name);
	});
});
