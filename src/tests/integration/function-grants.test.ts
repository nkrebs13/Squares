import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	claimCell,
	cleanupParty,
	createTestParty,
	ensureSupabaseReady,
	getServiceRoleClient,
	getTestClient,
	type TestParty,
	getTestDatabaseUrl,
} from './helpers';

// The functions a browser may call. Everything else in `public` is internal
// (migration 034). Adding an RPC means adding it here AND granting it.
const CLIENT_API = [
	'claim_squares',
	'get_party_preview',
	'get_party_state',
	'host_create_party',
	'host_delete_party',
	'host_lock_party',
	'host_record_score',
	'host_remove_player',
	'host_update_details',
	'host_update_payouts',
	'host_verify_pin',
	'save_push_subscription',
	'unclaim_square',
];

const databaseUrl = getTestDatabaseUrl();
const db = new pg.Client({ connectionString: databaseUrl });

beforeAll(async () => {
	await ensureSupabaseReady();
	await db.connect();
});

afterAll(async () => {
	await db.end();
});

async function functionsExecutableBy(role: string, client: pg.Client = db): Promise<string[]> {
	const { rows } = await client.query<{ proname: string }>(
		`SELECT DISTINCT p.proname
		 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
		 WHERE n.nspname = 'public' AND has_function_privilege($1, p.oid, 'EXECUTE')
		 ORDER BY p.proname`,
		[role]
	);
	return rows.map((r) => r.proname);
}

describe('function grants', () => {
	it.each(['anon', 'authenticated'])('%s can execute exactly the client API', async (role) => {
		expect(await functionsExecutableBy(role)).toEqual([...CLIENT_API].sort());
	});

	it('a newly created function is not executable by anon', async () => {
		await db.query('BEGIN');
		try {
			await db.query(
				'CREATE FUNCTION public.grant_probe() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$'
			);
			expect(await functionsExecutableBy('anon')).not.toContain('grant_probe');
		} finally {
			await db.query('ROLLBACK');
		}
	});

	it('service_role keeps EXECUTE on the internal helpers', async () => {
		const executable = await functionsExecutableBy('service_role');
		for (const fn of ['auto_update_score', 'host_pin_check', 'log_audit_event']) {
			expect(executable).toContain(fn);
		}
	});
});

describe('push subscriptions', () => {
	const client = getTestClient();
	let party: TestParty;

	beforeAll(async () => {
		party = await createTestParty(client);
		expect(await claimCell(client, party.id, 0, 0, 'Alice')).toBe(true);
	});

	afterAll(async () => {
		await cleanupParty(client, party.id);
	});

	async function subscriptionRows() {
		const { data, error } = await getServiceRoleClient()
			.from('push_subscriptions')
			.select('player_name, endpoint, p256dh')
			.eq('party_id', party.id)
			.order('endpoint');
		if (error) throw error;
		return data;
	}

	function save(playerName: string, endpoint: string, p256dh = 'key-1') {
		return client.rpc('save_push_subscription', {
			p_party_id: party.id,
			p_player_name: playerName,
			p_endpoint: endpoint,
			p_p256dh: p256dh,
			p_auth: 'auth-1',
		});
	}

	it('saves and refreshes a player subscription', async () => {
		expect((await save(' alice ', 'https://push.example/a')).data).toBe(true);
		expect((await save('Alice', 'https://push.example/a', 'key-2')).data).toBe(true);

		expect(await subscriptionRows()).toEqual([
			{ player_name: 'Alice', endpoint: 'https://push.example/a', p256dh: 'key-2' },
		]);
	});

	it('refuses an endpoint that is not an https URL', async () => {
		expect((await save('Alice', 'http://169.254.169.254/latest')).data).toBe(false);
		expect((await save('Alice', `https://push.example/${'x'.repeat(2100)}`)).data).toBe(false);
	});

	it('refuses a name that holds no square in the party', async () => {
		expect((await save('Mallory', 'https://push.example/m')).data).toBe(false);
		expect((await subscriptionRows()).map((r) => r.endpoint)).not.toContain(
			'https://push.example/m'
		);
	});

	it('anon cannot read, repoint or delete subscriptions directly', async () => {
		const select = await client.from('push_subscriptions').select('id').eq('party_id', party.id);
		expect(select.error?.code).toBe('42501');

		const update = await client
			.from('push_subscriptions')
			.update({ endpoint: 'https://push.example/stolen' })
			.eq('party_id', party.id);
		expect(update.error?.code).toBe('42501');

		const del = await client.from('push_subscriptions').delete().eq('party_id', party.id);
		expect(del.error?.code).toBe('42501');

		expect(await subscriptionRows()).toHaveLength(1);
	});

	it('a full party still refreshes its devices but takes no new one', async () => {
		// The cap trigger fires before ON CONFLICT resolves, so the save must update an
		// existing endpoint before it tries to insert (an upsert would refuse this refresh).
		const full = await createTestParty(client);
		const service = getServiceRoleClient();
		try {
			expect(await claimCell(client, full.id, 0, 0, 'Bob')).toBe(true);
			const rows = Array.from({ length: 200 }, (_, i) => ({
				party_id: full.id,
				player_name: 'Bob',
				endpoint: `https://push.example/full-${i}`,
				p256dh: 'key-1',
				auth: 'auth-1',
			}));
			expect((await service.from('push_subscriptions').insert(rows)).error).toBeNull();
			const saveTo = (endpoint: string, p256dh: string) =>
				client.rpc('save_push_subscription', {
					p_party_id: full.id,
					p_player_name: 'Bob',
					p_endpoint: endpoint,
					p_p256dh: p256dh,
					p_auth: 'auth-1',
				});

			const refresh = await saveTo('https://push.example/full-7', 'key-2');
			expect(refresh.error).toBeNull();
			expect(refresh.data).toBe(true);

			const extra = await saveTo('https://push.example/full-200', 'key-1');
			expect(extra.error?.message).toContain('Push subscription limit reached');

			const { data, error } = await service
				.from('push_subscriptions')
				.select('endpoint, p256dh')
				.eq('party_id', full.id);
			expect(error).toBeNull();
			expect(data).toHaveLength(200);
			expect(data?.find((r) => r.endpoint.endsWith('/full-7'))?.p256dh).toBe('key-2');
		} finally {
			await cleanupParty(client, full.id);
		}
	});
});

// Browsers only ever read tables (everything else goes through the functions above),
// and only these (migration 042). parties is readable column by column, not as a table.
const CLIENT_READABLE_TABLES = ['game_scores', 'numbers', 'scores', 'squares', 'winners'];

/**
 * What `role` can do to each table, view or sequence in public, as Postgres decides it:
 * direct grants, grants to PUBLIC and role membership all count (has_*_privilege), so a
 * grant to PUBLIC cannot slip past. A table readable only column by column (parties)
 * does not count as table-readable.
 */
async function tablePrivilegesOf(role: string): Promise<string[]> {
	const { rows } = await db.query<{ entry: string }>(
		`SELECT c.relname || ':' || p.priv AS entry
		 FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
		 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) AS p(priv)
		 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f') AND has_table_privilege($1, c.oid, p.priv)
		 UNION ALL
		 SELECT c.relname || ':' || p.priv
		 FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
		 CROSS JOIN unnest(ARRAY['USAGE','SELECT','UPDATE']) AS p(priv)
		 WHERE c.relkind = 'S' AND has_sequence_privilege($1, c.oid, p.priv)
		 ORDER BY 1`,
		[role]
	);
	return rows.map((r) => r.entry);
}

/**
 * Column-level rights of `role` in public, as Postgres decides them (table-level
 * grants, column grants, PUBLIC and role membership all count). A column grant is
 * invisible to has_table_privilege, so this is what catches e.g.
 * `GRANT UPDATE (player_name) ON squares TO anon`.
 */
async function columnPrivilegesOf(role: string): Promise<{ table: string; priv: string }[]> {
	const { rows } = await db.query<{ table: string; priv: string }>(
		`SELECT DISTINCT c.relname AS table, p.priv
		 FROM pg_class c
		 JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
		 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
		 CROSS JOIN unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) AS p(priv)
		 WHERE c.relkind IN ('r', 'p', 'v', 'm', 'f')
		   AND has_column_privilege($1, c.oid, a.attnum, p.priv)
		 ORDER BY 1, 2`,
		[role]
	);
	return rows;
}

describe('table privileges', () => {
	it.each(['anon', 'authenticated'])(
		'%s may only SELECT the client-readable tables',
		async (role) => {
			expect(await tablePrivilegesOf(role)).toEqual(
				CLIENT_READABLE_TABLES.map((t) => `${t}:SELECT`)
			);
		}
	);

	it.each(['anon', 'authenticated'])(
		'%s may read columns only of the readable tables and parties, and write none',
		async (role) => {
			const rights = await columnPrivilegesOf(role);
			expect(rights.filter((r) => r.priv !== 'SELECT')).toEqual([]);
			expect(rights.map((r) => r.table)).toEqual([...CLIENT_READABLE_TABLES, 'parties'].sort());
		}
	);

	it('counts a column-level write grant', async () => {
		await db.query('BEGIN');
		try {
			await db.query('GRANT UPDATE (player_name) ON public.squares TO anon');
			expect(await columnPrivilegesOf('anon')).toContainEqual({ table: 'squares', priv: 'UPDATE' });
		} finally {
			await db.query('ROLLBACK');
		}
	});

	it('a newly created table or sequence grants anon nothing', async () => {
		await db.query('BEGIN');
		try {
			await db.query('CREATE TABLE public.grant_probe (id serial)');
			const probe = (await tablePrivilegesOf('anon')).filter((e) => e.startsWith('grant_probe'));
			expect(probe).toEqual([]);
		} finally {
			await db.query('ROLLBACK');
		}
	});

	it('counts a grant to PUBLIC (it reaches every role)', async () => {
		await db.query('BEGIN');
		try {
			await db.query('CREATE TABLE public.grant_probe (id int)');
			await db.query('GRANT INSERT ON public.grant_probe TO PUBLIC');
			expect(await tablePrivilegesOf('anon')).toContain('grant_probe:INSERT');
		} finally {
			await db.query('ROLLBACK');
		}
	});
});
