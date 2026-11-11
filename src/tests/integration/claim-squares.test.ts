import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	createTestParty,
	ensureSupabaseReady,
	forceDeleteParty,
	getTestClient,
	type TestParty,
} from './helpers';

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

	it('refuses once the grid is locked', async () => {
		const party = await newParty('active');
		expect(await claim(party, 'Alice', [{ row: 0, col: 0 }])).toEqual({
			ok: false,
			error: 'wrong_status',
		});
	});

	it.each([
		['a blank name', '  ', [{ row: 0, col: 0 }], 'player_name'],
		['a name over 50 characters', 'x'.repeat(51), [{ row: 0, col: 0 }], 'player_name'],
		['no cells', 'Alice', [], 'cells'],
		['a cell off the grid', 'Alice', [{ row: 10, col: 0 }], 'cells'],
		['a fractional cell', 'Alice', [{ row: 1.5, col: 0 }], 'cells'],
		['a malformed cell', 'Alice', [{ row: '1', col: 0 }], 'cells'],
	])('refuses %s', async (_label, name, cells, field) => {
		const party = await newParty();
		expect(await claim(party, name as string, cells)).toEqual({
			ok: false,
			error: 'invalid_input',
			field,
		});
	});
});
