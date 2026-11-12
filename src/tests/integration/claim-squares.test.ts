import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	createTestParty,
	ensureSupabaseReady,
	forceDeleteParty,
	getTestClient,
	type TestParty,
	waitUntilBlockedOnLock,
	getTestDatabaseUrl,
} from './helpers';

// player_name is VARCHAR(50); no shared constant exists for it.
const DB_MAX_NAME_LENGTH = 50;

// claim_squares (migration 038): claims a set of cells and reports which it
// got and who holds the rest.

const client = getTestClient();
const created: string[] = [];

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	for (const id of created.splice(0)) await forceDeleteParty(id);
});

async function newParty(status?: string): Promise<TestParty> {
	const party = await createTestParty(client, status ? { status } : {});
	created.push(party.id);
	return party;
}

async function claim(party: TestParty, name: string, cells: unknown) {
	const { data, error } = await client.rpc('claim_squares', {
		p_party_id: party.id,
		p_player_name: name,
		p_cells: cells,
	});
	expect(error).toBeNull();
	return data;
}

const byCell = (a: { row: number; col: number }, b: { row: number; col: number }) =>
	a.row - b.row || a.col - b.col;

describe('claim_squares', () => {
	it('claims one cell', async () => {
		const party = await newParty();
		expect(await claim(party, ' Alice ', [{ row: 3, col: 4 }])).toEqual({
			ok: true,
			claimed: [{ row: 3, col: 4 }],
			taken: [],
		});

		const { data } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 3)
			.eq('col_num', 4)
			.single();
		expect(data?.player_name).toBe('Alice');
	});

	it('reports which cells were already taken, and by whom', async () => {
		const party = await newParty();
		await claim(party, 'Bob', [{ row: 0, col: 1 }]);

		const data = await claim(party, 'Alice', [
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 },
			{ row: 0, col: 2 },
		]);

		expect(data.ok).toBe(true);
		expect([...data.claimed].sort(byCell)).toEqual([
			{ row: 0, col: 0 },
			{ row: 0, col: 2 },
		]);
		expect(data.taken).toEqual([{ row: 0, col: 1, player_name: 'Bob' }]);
	});

	it('stores the name trimmed with a case-insensitive lowercase twin and a claim time', async () => {
		const party = await newParty();
		await claim(party, 'Alice McName', [{ row: 2, col: 3 }]);

		const { data } = await client
			.from('squares')
			.select('player_name, player_name_lower, claimed_at')
			.eq('party_id', party.id)
			.eq('row_num', 2)
			.eq('col_num', 3)
			.single();
		expect(data?.player_name).toBe('Alice McName');
		expect(data?.player_name_lower).toBe('alice mcname');
		expect(data?.claimed_at).not.toBeNull();
	});

	it('answers not_found for an unknown party', async () => {
		const { data, error } = await client.rpc('claim_squares', {
			p_party_id: '00000000-0000-0000-0000-000000000000',
			p_player_name: 'Alice',
			p_cells: [{ row: 0, col: 0 }],
		});
		expect(error).toBeNull();
		expect(data).toEqual({ ok: false, error: 'not_found' });
	});

	it('concurrent claims of one cell: exactly one wins, the other is told who did', async () => {
		const party = await newParty();
		const cell = [{ row: 5, col: 5 }];

		const [a, b] = await Promise.all([claim(party, 'Alice', cell), claim(party, 'Bob', cell)]);

		expect(a.claimed.length + b.claimed.length).toBe(1);
		const winner = a.claimed.length === 1 ? 'Alice' : 'Bob';
		const loser = a.claimed.length === 1 ? b : a;
		expect(loser.taken).toEqual([{ row: 5, col: 5, player_name: winner }]);

		const { data } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.eq('row_num', 5)
			.eq('col_num', 5)
			.single();
		expect(data?.player_name).toBe(winner);
	});

	it.each(['active', 'complete'])('refuses once the party is %s', async (status) => {
		const party = await newParty(status);
		expect(await claim(party, 'Alice', [{ row: 0, col: 0 }])).toEqual({
			ok: false,
			error: 'wrong_status',
		});
	});

	it.each([
		['a blank name', '  ', [{ row: 0, col: 0 }], 'player_name'],
		[
			'a name over the column limit',
			'x'.repeat(DB_MAX_NAME_LENGTH + 1),
			[{ row: 0, col: 0 }],
			'player_name',
		],
		['no cells', 'Alice', [], 'cells'],
		['a cell off the grid', 'Alice', [{ row: 10, col: 0 }], 'cells'],
		['a fractional cell', 'Alice', [{ row: 1.5, col: 0 }], 'cells'],
		['a malformed cell', 'Alice', [{ row: '1', col: 0 }], 'cells'],
		['a non-numeric cell', 'Alice', [{ row: 'x', col: 0 }], 'cells'],
	])('refuses %s', async (_label, name, cells, field) => {
		const party = await newParty();
		expect(await claim(party, name as string, cells)).toEqual({
			ok: false,
			error: 'invalid_input',
			field,
		});
	});

	it('names the winner of a cell another claimer took while we waited for it', async () => {
		const party = await newParty();
		const url = getTestDatabaseUrl();
		const rival = new pg.Client({ connectionString: url });
		const us = new pg.Client({ connectionString: url });
		await rival.connect();
		await us.connect();
		const { rows: pidRows } = await us.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
		try {
			await rival.query('BEGIN');
			await rival.query(
				`UPDATE squares SET player_name = 'Bob', claimed_at = NOW()
				 WHERE party_id = $1 AND row_num = 0 AND col_num = 0`,
				[party.id]
			);

			const ours = us.query('SELECT claim_squares($1, $2, $3::jsonb) AS result', [
				party.id,
				'Alice',
				JSON.stringify([
					{ row: 0, col: 0 },
					{ row: 0, col: 1 },
				]),
			]);
			// Wait until our UPDATE is blocked on Bob's row lock.
			await waitUntilBlockedOnLock(rival, pidRows[0].pid);
			await rival.query('COMMIT');

			const { rows } = await ours;
			expect(rows[0].result).toEqual({
				ok: true,
				claimed: [{ row: 0, col: 1 }],
				taken: [{ row: 0, col: 0, player_name: 'Bob' }],
			});
		} finally {
			await rival.end();
			await us.end();
		}
	});
});
