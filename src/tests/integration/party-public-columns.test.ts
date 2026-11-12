import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	createTestParty,
	ensureSupabaseReady,
	forceDeleteParty,
	getTestClient,
	getTestDatabaseUrl,
} from './helpers';

// public_party_json strips private columns with a denylist, while direct table
// reads are limited by an allowlist of column grants. The two must agree: a new
// column on `parties` fails here until it is either granted to anon (and so
// returned) or stripped (and so not granted).

const client = getTestClient();
const db = new pg.Client({ connectionString: getTestDatabaseUrl() });
const created: string[] = [];

beforeAll(async () => {
	await ensureSupabaseReady();
	await db.connect();
});

afterEach(async () => {
	for (const id of created.splice(0)) await forceDeleteParty(id);
});

afterAll(async () => {
	await db.end();
});

async function anonSelectableColumns(): Promise<string[]> {
	const { rows } = await db.query<{ column_name: string }>(
		`SELECT DISTINCT column_name
		 FROM information_schema.column_privileges
		 WHERE table_schema = 'public' AND table_name = 'parties'
		   AND grantee = 'anon' AND privilege_type = 'SELECT'
		 ORDER BY column_name`
	);
	return rows.map((r) => r.column_name);
}

describe('public party columns', () => {
	it('anon is granted SELECT on some columns but not the private ones', async () => {
		const granted = await anonSelectableColumns();
		expect(granted.length).toBeGreaterThan(0);
		for (const column of ['host_pin', 'pin_attempts', 'pin_locked_until']) {
			expect(granted).not.toContain(column);
		}
	});

	it('get_party_state returns exactly the columns anon may SELECT', async () => {
		const party = await createTestParty(client);
		created.push(party.id);

		const { data, error } = await client.rpc('get_party_state', { p_code: party.code });

		expect(error).toBeNull();
		expect(Object.keys(data.party).sort()).toEqual(await anonSelectableColumns());
		expect(data.party).not.toHaveProperty('pin_locked_until');
	});

	it('get_party_preview returns exactly the columns anon may SELECT', async () => {
		const party = await createTestParty(client);
		created.push(party.id);

		const { data, error } = await client.rpc('get_party_preview', { p_code: party.code });

		expect(error).toBeNull();
		expect(Object.keys(data.party).sort()).toEqual(await anonSelectableColumns());
		expect(data.party).not.toHaveProperty('pin_locked_until');
	});
});
