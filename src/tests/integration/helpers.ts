import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertLocalSupabaseUrl } from './assertLocalDb';

// Precedence matches vitest.config.integration.ts's `test.env` block so the
// main vitest process (which runs globalSetup/globalTeardown) and worker
// threads (which run the test bodies) always resolve the same URL.
const SUPABASE_URL =
	process.env.TEST_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY =
	process.env.TEST_SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'not-set';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'not-set';

// Fires at module load, before any client can be constructed or any network
// call made. This is the only way a non-local host is accepted:
// ALLOW_REMOTE_INTEGRATION_DB=1. See assertLocalDb.ts for why this exists —
// cleanupAllTestParties() below runs as a service-role DELETE against
// whatever SUPABASE_URL resolves to.
assertLocalSupabaseUrl(SUPABASE_URL, process.env.ALLOW_REMOTE_INTEGRATION_DB === '1');

/** Direct Postgres connection string for tests that need raw SQL or several connections. */
export function getTestDatabaseUrl(): string {
	return process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
}

/**
 * Create a Supabase client for integration tests.
 * Connects to local Supabase instance started via `supabase start`.
 */
export function getTestClient(): SupabaseClient {
	return createClient(SUPABASE_URL, SUPABASE_KEY);
}

/**
 * Create a service-role client for assertions against server-only tables.
 * Integration tests use this for audit_log because anon SELECT was intentionally
 * revoked by migration 024.
 */
export function getServiceRoleClient(): SupabaseClient {
	return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

/**
 * Ping the Supabase REST API to verify connectivity.
 * Call this in a `beforeAll` to get a clear error instead of cryptic connection failures.
 */
export async function ensureSupabaseReady(): Promise<void> {
	const client = getTestClient();
	const { error } = await client.from('parties').select('id').limit(1);
	if (error) {
		throw new Error(
			`Supabase is not reachable at ${SUPABASE_URL}. ` +
				`Ensure 'supabase start' is running. Error: ${error.message}`
		);
	}
}

/** Generate a random 6-character uppercase party code */
function randomCode(): string {
	const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
	let result = '';
	for (let i = 0; i < 6; i++) {
		result += chars[Math.floor(Math.random() * chars.length)];
	}
	return result;
}

export interface TestParty {
	id: string;
	code: string;
	host_pin: string;
}

/**
 * Create a test party with 100 empty squares and a scores row.
 * Returns the party id, code, and host_pin for use in tests.
 */
export async function createTestParty(
	client: SupabaseClient,
	overrides: {
		square_price?: number;
		split_q1?: number;
		split_q2?: number;
		split_q3?: number;
		split_final?: number;
		status?: string;
		team_row_name?: string;
		team_col_name?: string;
	} = {}
): Promise<TestParty> {
	const host_pin = '1234';

	const { data, error: partyError } = await client.rpc('host_create_party', {
		p_host_name: `Host ${randomCode()}`,
		p_pin: host_pin,
		p_square_price: overrides.square_price ?? 1.0,
		p_split_q1: overrides.split_q1 ?? 25,
		p_split_q2: overrides.split_q2 ?? 25,
		p_split_q3: overrides.split_q3 ?? 25,
		p_split_final: overrides.split_final ?? 25,
		p_team_row_name: overrides.team_row_name ?? 'Eagles',
		p_team_col_name: overrides.team_col_name ?? 'Chiefs',
		p_team_row_color: '#004C54',
		p_team_col_color: '#E31837',
		p_event_name: 'Integration Test Game',
		p_kickoff_at: null,
	});

	if (partyError) throw new Error(`Failed to create party: ${partyError.message}`);
	if (!data?.ok) throw new Error(`Failed to create party: ${JSON.stringify(data)}`);
	const party = data.party;

	if (overrides.status && overrides.status !== 'filling') {
		const { error: statusError } = await getServiceRoleClient()
			.from('parties')
			.update({ status: overrides.status })
			.eq('id', party.id);
		if (statusError) throw new Error(`Failed to set party status: ${statusError.message}`);
	}

	return { id: party.id, code: party.code, host_pin };
}

/** Wrong PINs a party tolerates before the host gate locks it out (migration 035). */
export const MAX_ATTEMPTS = 5;

/**
 * Fill all 100 squares with test player names.
 * Uses pattern "Player-R{row}C{col}" so each square has a unique, predictable name.
 * Batches updates 10 at a time (one row per batch) via Promise.all for performance.
 */
export async function fillAllSquares(partyId: string): Promise<void> {
	const service = getServiceRoleClient();
	for (let row = 0; row < 10; row++) {
		const updates = Array.from({ length: 10 }, (_, col) =>
			service
				.from('squares')
				.update({ player_name: `Player-R${row}C${col}`, claimed_at: new Date().toISOString() })
				.eq('party_id', partyId)
				.eq('row_num', row)
				.eq('col_num', col)
				.then(({ error }) => {
					if (error) throw new Error(`Failed to fill square (${row},${col}): ${error.message}`);
				})
		);
		await Promise.all(updates);
	}
}

/**
 * Delete a test party and all cascaded children (squares, numbers, scores, winners).
 * Goes through host_delete_party (SECURITY DEFINER): direct DELETE is blocked by RLS
 * (no DELETE policy on parties). Refused while the party is in PIN lockout; use
 * forceDeleteParty for tests that drive a party into lockout.
 */
export async function cleanupParty(client: SupabaseClient, partyId: string): Promise<void> {
	const { data, error } = await client.rpc('host_delete_party', {
		p_party_id: partyId,
		p_pin: '1234',
	});
	if (error) throw new Error(`cleanupParty failed: ${error.message}`);
	if (!data?.ok && data?.error !== 'not_found') {
		throw new Error(`cleanupParty refused: ${data?.error} (use forceDeleteParty)`);
	}
}

/**
 * Force-delete a party via the service-role client, bypassing RLS and the PIN
 * gate inside host_delete_party. Required for tests that intentionally drive a
 * party into PIN lockout: host_delete_party('1234') would itself be refused
 * (locked_out) while the lockout is active, leaking the row. Cascades to
 * squares/numbers/scores/winners via the FK ON DELETE CASCADE.
 */
export async function forceDeleteParty(partyId: string): Promise<void> {
	const service = getServiceRoleClient();
	const { error } = await service.from('parties').delete().eq('id', partyId);
	if (error) throw new Error(`forceDeleteParty failed: ${error.message}`);
}

/**
 * Delete all test parties created more than 1 hour ago.
 * Catches orphans from interrupted test runs. Safe to call in globalSetup/globalTeardown.
 */
export async function cleanupAllTestParties(): Promise<void> {
	const client = getServiceRoleClient();
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

	// Delete parties created before the cutoff with the test pin '1234'
	const { data: staleParties, error } = await client
		.from('parties')
		.select('id')
		.eq('host_pin', '1234')
		.lt('created_at', oneHourAgo);
	if (error) throw new Error(`cleanupAllTestParties lookup failed: ${error.message}`);

	if (staleParties && staleParties.length > 0) {
		// Service-role delete: a stale party may be in PIN lockout, which would
		// make host_delete_party refuse the cleanup.
		await client
			.from('parties')
			.delete()
			.in(
				'id',
				staleParties.map((p) => p.id)
			);
	}
}

/**
 * Lock a party via the RPC, which generates numbers and sets status to 'active'.
 * Requires all 100 squares to be filled first.
 */
export async function lockParty(
	client: SupabaseClient,
	partyId: string,
	pin: string
): Promise<boolean> {
	const { data, error } = await client.rpc('host_lock_party', {
		p_party_id: partyId,
		p_pin: pin,
	});
	if (error) throw new Error(`host_lock_party RPC error: ${error.message}`);
	return data?.ok === true;
}

export interface Cell {
	row: number;
	col: number;
}

export interface ClaimResult {
	ok: boolean;
	claimed?: Cell[];
	taken?: (Cell & { player_name: string })[];
	error?: string;
	field?: string;
}

/** Claim a set of cells through the claim_squares RPC and return its result object. */
export async function claimSquares(
	client: SupabaseClient,
	partyId: string,
	playerName: string,
	cells: Cell[]
): Promise<ClaimResult> {
	const { data, error } = await client.rpc('claim_squares', {
		p_party_id: partyId,
		p_player_name: playerName,
		p_cells: cells,
	});
	if (error) throw new Error(`claim_squares RPC error: ${error.message}`);
	return data as ClaimResult;
}

/** Claim one cell; returns true when this call got it. */
export async function claimCell(
	client: SupabaseClient,
	partyId: string,
	row: number,
	col: number,
	playerName: string
): Promise<boolean> {
	const result = await claimSquares(client, partyId, playerName, [{ row, col }]);
	return result.ok && (result.claimed?.length ?? 0) === 1;
}

/** Poll pg_stat_activity until the given backend pid is blocked waiting on a lock. */
export async function waitUntilBlockedOnLock(
	poller: {
		query: (sql: string, params: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
	},
	pid: number,
	timeoutMs = 5000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { rows } = await poller.query(
			'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
			[pid]
		);
		if (rows[0]?.wait_event_type === 'Lock') return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Backend ${pid} never entered a Lock wait state within ${timeoutMs}ms`);
}
