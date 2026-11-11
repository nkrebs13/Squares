import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	cleanupParty,
	createTestParty,
	fillAllSquares,
	ensureSupabaseReady,
	getServiceRoleClient,
	getTestClient,
	type TestParty,
} from './helpers';

// The functions a browser may call. Everything else in `public` is internal
// (migration 034). Adding an RPC means adding it here AND granting it.
const CLIENT_API = [
	'claim_square',
	'claim_squares_batch',
	'create_party',
	'delete_party',
	'host_create_party',
	'host_delete_party',
	'host_lock_party',
	'host_record_score',
	'host_remove_player',
	'host_update_details',
	'host_update_payouts',
	'host_verify_pin',
	'lock_party',
	'remove_player',
	'save_push_subscription',
	'sync_party_home_team_mapping',
	'unclaim_square',
	'update_party_details',
	'update_payout_structure',
	'update_score',
	'verify_host_pin',
];

const databaseUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
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
		for (const fn of ['auto_update_score', 'check_pin_lockout', 'log_audit_event']) {
			expect(executable).toContain(fn);
		}
	});

	it('anon cannot write scores through auto_update_score', async () => {
		const { error } = await getTestClient().rpc('auto_update_score', {
			p_party_id: '00000000-0000-0000-0000-000000000000',
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});
		expect(error?.code).toBe('42501');
	});
});

describe('push subscriptions', () => {
	const client = getTestClient();
	let party: TestParty;

	beforeAll(async () => {
		party = await createTestParty(client);
		const { data } = await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});
		expect(data).toBe(true);
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
});

describe('live score trigger chain', () => {
	const client = getTestClient();
	const service = getServiceRoleClient();
	const gameId = `gt-${Date.now()}`;
	let party: TestParty;

	beforeAll(async () => {
		party = await createTestParty(client);
		await fillAllSquares(client, party.id);
		const { data } = await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});
		expect(data).toBe(true);
		const game = await service.from('game_scores').insert({
			game_id: gameId,
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Eagles',
			away_team_name: 'Chiefs',
			game_status: 'in_progress',
		});
		if (game.error) throw game.error;
		const link = await service.from('parties').update({ game_id: gameId }).eq('id', party.id);
		if (link.error) throw link.error;
	});

	afterAll(async () => {
		await cleanupParty(client, party.id);
		await service.from('game_scores').delete().eq('game_id', gameId);
	});

	it('a game_scores quarter result still records the winner through the internal helpers', async () => {
		const { error } = await service
			.from('game_scores')
			.update({ q1_home: 7, q1_away: 3 })
			.eq('game_id', gameId);
		if (error) throw error;

		const { data: winners } = await client
			.from('winners')
			.select('quarter')
			.eq('party_id', party.id);
		expect(winners).toEqual([{ quarter: 'q1' }]);
	});
});
