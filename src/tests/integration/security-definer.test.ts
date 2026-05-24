import { afterAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const { Client } = pg;

const databaseUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

const client = new Client({ connectionString: databaseUrl });
let connected = false;

async function getClient(): Promise<pg.Client> {
	if (connected) return client;
	await client.connect();
	connected = true;
	return client;
}

afterAll(async () => {
	if (connected) {
		await client.end();
		connected = false;
	}
});

describe('security definer hardening', () => {
	it('pins search_path for every SECURITY DEFINER function in public', async () => {
		const db = await getClient();
		const { rows } = await db.query<{ function_name: string; search_path: string | null }>(`
			SELECT p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS function_name,
			       (
			         SELECT split_part(setting, '=', 2)
			         FROM unnest(p.proconfig) AS setting
			         WHERE setting LIKE 'search_path=%'
			       ) AS search_path
			FROM pg_proc p
			JOIN pg_namespace n ON n.oid = p.pronamespace
			WHERE n.nspname = 'public'
			  AND p.prosecdef
			ORDER BY function_name
		`);

		expect(rows).not.toHaveLength(0);
		const unpinnedFunctions = rows.filter((row) => row.search_path !== 'public, extensions');
		expect(unpinnedFunctions).toEqual([]);
	});
});
