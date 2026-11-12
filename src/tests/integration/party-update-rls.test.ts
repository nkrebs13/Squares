import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	cleanupParty,
	createTestParty,
	ensureSupabaseReady,
	getServiceRoleClient,
	getTestClient,
	type TestParty,
} from './helpers';

const client = getTestClient();
const service = getServiceRoleClient();
const createdPartyIds: string[] = [];

async function createParty(): Promise<TestParty> {
	const party = await createTestParty(client);
	createdPartyIds.push(party.id);
	return party;
}

describe('party update RLS hardening', () => {
	beforeAll(async () => {
		await ensureSupabaseReady();
	});

	afterEach(async () => {
		while (createdPartyIds.length > 0) {
			const partyId = createdPartyIds.pop();
			if (partyId) await cleanupParty(client, partyId);
		}
	});

	it('does not expose host PIN columns through public party reads', async () => {
		const party = await createParty();

		const { data, error } = await client
			.from('parties')
			.select('id, code, host_pin')
			.eq('id', party.id)
			.single();

		expect(data).toBeNull();
		expect(error).toBeTruthy();
		expect(error?.message ?? '').toMatch(/permission|host_pin/i);
	});

	it.each(['parties', 'squares', 'numbers', 'scores', 'winners'])(
		'anon cannot insert, update or delete rows of %s directly',
		async (table) => {
			const party = await createParty();
			// parties is keyed by id, everything else by party_id.
			const key = table === 'parties' ? 'id' : 'party_id';
			const beforeRows = await service.from(table).select('*').eq(key, party.id);
			expect(beforeRows.error).toBeNull();

			const insert = await client
				.from(table)
				.insert(
					table === 'parties' ? { code: 'RLSBAD', host_pin: '0000' } : { party_id: party.id }
				);
			const update = await client
				.from(table)
				.update(table === 'parties' ? { split_q1: 10 } : { party_id: party.id })
				.eq(key, party.id);
			const del = await client.from(table).delete().eq(key, party.id);

			expect(insert.error?.code).toBe('42501');
			expect(update.error?.code).toBe('42501');
			expect(del.error?.code).toBe('42501');

			const afterRows = await service.from(table).select('*').eq(key, party.id);
			expect(afterRows.data).toEqual(beforeRows.data);
		}
	);
});
