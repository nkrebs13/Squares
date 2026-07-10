import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import pg from 'pg';
import {
	getTestClient,
	getServiceRoleClient,
	createTestParty,
	fillAllSquares,
	cleanupParty,
	type TestParty,
} from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

const { Client } = pg;

// Regression coverage for the lock_party / unclaim_square TOCTOU race fixed in
// migration 032. See that migration's header comment for the full mechanism
// writeup -- summarized here: lock_party now holds a `FOR UPDATE` lock on every
// squares row for the duration of its transaction, and unclaim_square now reads
// parties.status with `FOR UPDATE` (instead of a plain read) so it serializes
// against lock_party's existing parties-row lock (held since check_pin_lockout).
// Whichever RPC acquires the parties-row lock first now fully determines a
// happens-before order; the loser always observes the winner's committed state.
//
// This test exercises the REAL lock_party/unclaim_square functions (not a
// reimplementation of their SQL) over two raw `pg` connections so it can hold
// lock_party's transaction open past its internal commit point and force the
// exact interleaving the bug required: unclaim_square's status read must be
// issued *before* lock_party commits, so it's mid-flight and blocked on the
// parties-row lock when lock_party's commit finally releases it.

const databaseUrl =
	process.env.SUPABASE_DB_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Owner name for square (row, col), matching fillAllSquares' `Player-R${row}C${col}`
 * convention in ./helpers. Deriving it here (instead of a second hardcoded literal)
 * keeps the two from silently drifting apart -- a mismatch here would make this
 * test pass for the wrong reason (owner-name rejection) instead of the TOCTOU
 * status re-check it's meant to exercise.
 */
function squareOwnerName(row: number, col: number): string {
	return `Player-R${row}C${col}`;
}

let client: SupabaseClient;
let party: TestParty;
const openClients: InstanceType<typeof Client>[] = [];

beforeEach(async () => {
	client = getTestClient();
	party = await createTestParty(client);
});

afterEach(async () => {
	await cleanupParty(client, party.id);
});

afterAll(async () => {
	await Promise.all(openClients.splice(0).map((c) => c.end().catch(() => {})));
});

/** Poll pg_stat_activity until the given backend pid is blocked waiting on a lock. */
async function waitUntilBlockedOnLock(
	poller: InstanceType<typeof Client>,
	pid: number,
	timeoutMs = 5000
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const { rows } = await poller.query<{ wait_event_type: string | null }>(
			'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
			[pid]
		);
		if (rows[0]?.wait_event_type === 'Lock') return;
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
	throw new Error(`Backend ${pid} never entered a Lock wait state within ${timeoutMs}ms`);
}

describe('lock_party vs unclaim_square TOCTOU race (032)', () => {
	it('rejects a concurrent unclaim that reads status mid-lock, so an active party never ends up with an empty square', async () => {
		await fillAllSquares(client, party.id);

		const lockConn = new Client({ connectionString: databaseUrl });
		const unclaimConn = new Client({ connectionString: databaseUrl });
		openClients.push(lockConn, unclaimConn);
		await lockConn.connect();
		await unclaimConn.connect();

		const { rows: pidRows } = await unclaimConn.query<{ pid: number }>(
			'SELECT pg_backend_pid() AS pid'
		);
		const unclaimPid = pidRows[0].pid;

		let unclaimResult: boolean | undefined;
		try {
			// Open lock_party's transaction and hold it uncommitted. By the time
			// this resolves, lock_party has already: verified the PIN, locked the
			// parties row (via check_pin_lockout), locked every squares row, seen
			// the grid as full, generated numbers, inserted scores, and staged
			// status='active' -- all still uncommitted.
			await lockConn.query('BEGIN');
			const { rows: lockRows } = await lockConn.query<{ lock_party: boolean }>(
				'SELECT lock_party($1, $2) AS lock_party',
				[party.id, party.host_pin]
			);
			expect(lockRows[0].lock_party).toBe(true);

			// Fire the racing unclaim. Its own status read now uses FOR UPDATE
			// (the 032 fix), so it must block on lock_party's still-held
			// parties-row lock instead of reading a stale 'filling' status.
			const unclaimPromise = unclaimConn
				.query<{
					unclaim_square: boolean;
				}>('SELECT unclaim_square($1, 0, 0, $2) AS unclaim_square', [
					party.id,
					squareOwnerName(0, 0),
				])
				.then((res) => res.rows[0].unclaim_square);

			await waitUntilBlockedOnLock(lockConn, unclaimPid);

			// Only now does lock_party's transaction commit.
			await lockConn.query('COMMIT');

			unclaimResult = await unclaimPromise;
		} finally {
			await lockConn.query('ROLLBACK').catch(() => {});
		}

		// The fix: unclaim_square must observe the fresh, post-commit 'active'
		// status once unblocked and refuse to touch the square.
		expect(unclaimResult).toBe(false);

		// Invariant that actually matters: an active party never has an empty
		// square. Verified against the real committed state via the service role
		// client (pin_attempts/status columns aside, this reads plain columns).
		const service = getServiceRoleClient();
		const { data: partyRow, error: partyError } = await service
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();
		expect(partyError).toBeNull();
		expect(partyRow?.status).toBe('active');

		const { data: squares, error: squaresError } = await service
			.from('squares')
			.select('row_num, col_num, player_name')
			.eq('party_id', party.id);
		expect(squaresError).toBeNull();
		expect(squares).toHaveLength(100);
		expect(squares?.every((s) => s.player_name !== null)).toBe(true);
	});
});

describe('unclaim_square owner-name sanity check', () => {
	// Proves the `false` result asserted above is actually caused by the 032
	// TOCTOU status re-check, not by an owner-name mismatch: the real owner
	// (per fillAllSquares' Player-R${row}C${col} convention) genuinely CAN
	// unclaim their own square while the party is still 'filling'. Runs
	// against its own fresh party from beforeEach -- entirely separate from
	// the party the race test above locks/commits -- so it can't interfere
	// with that test's interleaving or leave residual state behind.
	it('lets the true owner (Player-R0C0) unclaim square (0,0) while the party is still filling', async () => {
		await fillAllSquares(client, party.id);

		const { data, error } = await client.rpc('unclaim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: squareOwnerName(0, 0),
		});

		expect(error).toBeNull();
		expect(data).toBe(true);

		const service = getServiceRoleClient();
		const { data: square, error: squareError } = await service
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 0)
			.eq('col_num', 0)
			.single();
		expect(squareError).toBeNull();
		expect(square?.player_name).toBeNull();
	});
});
