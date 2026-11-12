import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	claimCell,
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

	it('blocks direct anon updates to party rows', async () => {
		const party = await createParty();

		const { error } = await client
			.from('parties')
			.update({ split_q1: 10, split_q2: 20, split_q3: 30, split_final: 40 })
			.eq('id', party.id)
			.select('id');

		expect(error).toBeTruthy();
		expect(error?.message ?? '').toMatch(/permission|policy|rls|violates/i);

		const { data: persisted, error: readError } = await service
			.from('parties')
			.select('split_q1, split_q2, split_q3, split_final')
			.eq('id', party.id)
			.single();
		expect(readError).toBeNull();
		expect(persisted).toEqual({ split_q1: 25, split_q2: 25, split_q3: 25, split_final: 25 });
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

	it('blocks direct anon writes to squares while preserving the claim RPC', async () => {
		const party = await createParty();

		const { error: directError } = await client
			.from('squares')
			.update({ player_name: 'Mallory', claimed_at: new Date().toISOString() })
			.eq('party_id', party.id)
			.eq('row_num', 0)
			.eq('col_num', 0);

		expect(directError).toBeTruthy();

		expect(await claimCell(client, party.id, 0, 0, 'Alice')).toBe(true);
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
