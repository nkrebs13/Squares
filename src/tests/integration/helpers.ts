import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321';
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'not-set';

/**
 * Create a Supabase client for integration tests.
 * Connects to local Supabase instance started via `supabase start`.
 */
export function getTestClient(): SupabaseClient {
	return createClient(SUPABASE_URL, SUPABASE_KEY);
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
	const code = randomCode();
	const host_pin = '1234';

	const { data: party, error: partyError } = await client
		.from('parties')
		.insert({
			code,
			host_pin,
			square_price: overrides.square_price ?? 1.0,
			split_q1: overrides.split_q1 ?? 25,
			split_q2: overrides.split_q2 ?? 25,
			split_q3: overrides.split_q3 ?? 25,
			split_final: overrides.split_final ?? 25,
			status: overrides.status ?? 'filling',
		})
		.select('id')
		.single();

	if (partyError) throw new Error(`Failed to create party: ${partyError.message}`);

	// Insert 100 empty squares (10x10 grid)
	const squares = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			squares.push({ party_id: party.id, row_num: row, col_num: col });
		}
	}

	const { error: squaresError } = await client.from('squares').insert(squares);
	if (squaresError) throw new Error(`Failed to create squares: ${squaresError.message}`);

	return { id: party.id, code, host_pin };
}

/**
 * Fill all 100 squares with test player names.
 * Uses pattern "Player-R{row}C{col}" so each square has a unique, predictable name.
 * Batches updates 10 at a time (one row per batch) via Promise.all for performance.
 */
export async function fillAllSquares(client: SupabaseClient, partyId: string): Promise<void> {
	for (let row = 0; row < 10; row++) {
		const updates = Array.from({ length: 10 }, (_, col) =>
			client
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
	// Clean up audit_log entries referencing this party first (FK is ON DELETE SET NULL but we clean up anyway)
	await client.from('audit_log').delete().eq('party_id', partyId);
	await client.from('parties').delete().eq('id', partyId);
}

/**
 * Delete all test parties created more than 1 hour ago.
 * Catches orphans from interrupted test runs. Safe to call in globalSetup/globalTeardown.
 */
export async function cleanupAllTestParties(): Promise<void> {
	const client = getTestClient();
	const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

	// Delete parties created before the cutoff with the test pin '1234'
	const { data: staleParties } = await client
		.from('parties')
		.select('id')
		.eq('host_pin', '1234')
		.lt('created_at', oneHourAgo);

	if (staleParties && staleParties.length > 0) {
		const ids = staleParties.map((p) => p.id);
		await client.from('audit_log').delete().in('party_id', ids);
		await client.from('parties').delete().in('id', ids);
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
