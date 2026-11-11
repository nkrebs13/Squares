import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTestParty, ensureSupabaseReady, forceDeleteParty, getTestClient } from './helpers';

// get_party_preview (migration 040): the public party row and its filled count.

const client = getTestClient();
const created: string[] = [];

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	for (const id of created.splice(0)) await forceDeleteParty(id);
});

describe('get_party_preview', () => {
	it('returns the public party and how many squares are claimed', async () => {
		const party = await createTestParty(client);
		created.push(party.id);
		await client.rpc('claim_squares', {
			p_party_id: party.id,
			p_player_name: 'Alice',
			p_cells: [
				{ row: 0, col: 0 },
				{ row: 4, col: 2 },
			],
		});

		const { data, error } = await client.rpc('get_party_preview', {
			p_code: party.code.toLowerCase(),
		});

		expect(error).toBeNull();
		expect(data.filled_count).toBe(2);
		expect(data.party).toMatchObject({ id: party.id, status: 'filling' });
		expect(data.party).not.toHaveProperty('host_pin');
		expect(data.party).toHaveProperty('host_name_lower');
	});

	it('returns null for an unknown code', async () => {
		const { data } = await client.rpc('get_party_preview', { p_code: 'ZZZZZZ' });
		expect(data).toBeNull();
	});
});
