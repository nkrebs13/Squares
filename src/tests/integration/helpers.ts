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
	} = {}
): Promise<TestParty> {
	const host_pin = '1234';

	const { data: party, error: partyError } = await client.rpc('create_party', {
		p_host_name: `Host ${randomCode()}`,
		p_pin: host_pin,
		p_square_price: overrides.square_price ?? 1.0,
		p_split_q1: overrides.split_q1 ?? 25,
		p_split_q2: overrides.split_q2 ?? 25,
		p_split_q3: overrides.split_q3 ?? 25,
		p_split_final: overrides.split_final ?? 25,
		p_team_row_name: 'Eagles',
		p_team_col_name: 'Chiefs',
		p_team_row_color: '#004C54',
		p_team_col_color: '#E31837',
		p_event_name: 'Integration Test Game',
		p_kickoff_at: null,
	});

	if (partyError) throw new Error(`Failed to create party: ${partyError.message}`);

	if (overrides.status && overrides.status !== 'filling') {
		const { error: statusError } = await getServiceRoleClient()
			.from('parties')
			.update({ status: overrides.status })
			.eq('id', party.id);
		if (statusError) throw new Error(`Failed to set party status: ${statusError.message}`);
	}

	return { id: party.id, code: party.code, host_pin };
}

/**
 * Fill all 100 squares with test player names.
 * Uses pattern "Player-R{row}C{col}" so each square has a unique, predictable name.
 * Batches updates 10 at a time (one row per batch) via Promise.all for performance.
 */
export async function fillAllSquares(_client: SupabaseClient, partyId: string): Promise<void> {
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
 */
export async function cleanupParty(client: SupabaseClient, partyId: string): Promise<void> {
	// Use the delete_party RPC (SECURITY DEFINER) — direct DELETE is blocked by RLS
	// (no DELETE policy on parties table). The RPC cascades to squares, numbers, scores, winners.
	await client.rpc('delete_party', { p_party_id: partyId, p_pin: '1234' });
}

/**
 * Force-delete a party via the service-role client, bypassing RLS and the
 * check_pin_lockout gate inside delete_party. Required for tests that
 * intentionally drive a party into PIN lockout: delete_party('1234') would
 * itself be refused while the lockout is active (the correct PIN is throttled
 * too), leaking the row. Cascades to squares/numbers/scores/winners via the FK
 * ON DELETE CASCADE.
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
	const { data: staleParties } = await client
		.from('parties')
		.select('id')
		.eq('host_pin', '1234')
		.lt('created_at', oneHourAgo);

	if (staleParties && staleParties.length > 0) {
		for (const p of staleParties) {
			await client.rpc('delete_party', { p_party_id: p.id, p_pin: '1234' });
		}
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
	const { data, error } = await client.rpc('lock_party', {
		p_party_id: partyId,
		p_pin: pin,
	});
	if (error) throw new Error(`lock_party RPC error: ${error.message}`);
	return data as boolean;
}
