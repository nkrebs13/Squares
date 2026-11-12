import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	createTestParty,
	ensureSupabaseReady,
	forceDeleteParty,
	getTestClient,
	type TestParty,
} from './helpers';

// host_create_party / host_update_details (migration 036): one validator,
// refusals as {ok:false, error:'invalid_input', field}.

const client = getTestClient();
const created: string[] = [];

const VALID = {
	p_host_name: 'Host',
	p_pin: '1234',
	p_square_price: 5,
	p_split_q1: 25,
	p_split_q2: 25,
	p_split_q3: 25,
	p_split_final: 25,
	p_team_row_name: 'Eagles',
	p_team_col_name: 'Chiefs',
	p_team_row_color: '#004C54',
	p_team_col_color: '#E31837',
	p_event_name: 'Big Game',
	p_kickoff_at: null as string | null,
};

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	for (const id of created.splice(0)) await forceDeleteParty(id);
});

async function createParty(overrides: Partial<typeof VALID> = {}) {
	const { data, error } = await client.rpc('host_create_party', { ...VALID, ...overrides });
	expect(error).toBeNull();
	if (data?.ok) created.push(data.party.id);
	return data;
}

describe('host_create_party', () => {
	it('creates the party with 100 squares and a scores row, trimmed', async () => {
		const data = await createParty({ p_host_name: '  Host  ', p_team_row_name: ' Eagles ' });

		expect(data.ok).toBe(true);
		expect(data.party).toMatchObject({
			host_name_lower: 'host',
			team_row_name: 'Eagles',
			event_name: 'Big Game',
			status: 'filling',
		});
		expect(data.party).not.toHaveProperty('host_pin');
		expect(data.party.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);

		const { count } = await client
			.from('squares')
			.select('id', { count: 'exact', head: true })
			.eq('party_id', data.party.id);
		expect(count).toBe(100);
		const { data: scores } = await client
			.from('scores')
			.select('party_id')
			.eq('party_id', data.party.id);
		expect(scores).toHaveLength(1);
	});

	it('keeps a party at least two weeks past kickoff', async () => {
		const kickoff = new Date(Date.now() + 60 * 24 * 3600 * 1000).toISOString();
		const data = await createParty({ p_kickoff_at: kickoff });
		const expires = new Date(data.party.expires_at).getTime();
		expect(expires - new Date(kickoff).getTime()).toBeCloseTo(14 * 24 * 3600 * 1000, -5);
	});

	it('keeps the default cleanup window when kickoff is not known', async () => {
		const before = Date.now();
		const data = await createParty({ p_kickoff_at: null });
		const expires = new Date(data.party.expires_at).getTime();
		const thirtyDays = 30 * 24 * 3600 * 1000;
		expect(expires).toBeGreaterThanOrEqual(before + thirtyDays);
		expect(expires).toBeLessThan(Date.now() + thirtyDays + 60_000);
	});

	it('gives each party its own code and leaves every quarter score empty', async () => {
		const first = await createParty();
		const second = await createParty();
		expect(second.party.code).not.toBe(first.party.code);

		const { data: scores } = await client
			.from('scores')
			.select('*')
			.eq('party_id', first.party.id)
			.single();
		for (const q of ['q1', 'q2', 'q3', 'final']) {
			expect(scores?.[`${q}_row_score`]).toBeNull();
			expect(scores?.[`${q}_col_score`]).toBeNull();
		}

		const { data: squares } = await client
			.from('squares')
			.select('row_num, col_num')
			.eq('party_id', first.party.id);
		expect(new Set(squares?.map((s) => `${s.row_num}-${s.col_num}`)).size).toBe(100);
	});

	it.each([
		['host_name', { p_host_name: '   ' }],
		['host_name', { p_host_name: 'x'.repeat(51) }],
		['pin', { p_pin: '12a4' }],
		['pin', { p_pin: '12' }],
		['pin', { p_pin: '12345' }],
		['pin', { p_pin: '' }],
		['square_price', { p_square_price: 0 }],
		['square_price', { p_square_price: -1 }],
		['square_price', { p_square_price: 99999999999 }],
		['square_price', { p_square_price: 99999999.995 }],
		['square_price', { p_square_price: 0.004 }],
		['splits', { p_split_final: 26 }],
		['event_name', { p_event_name: '  ' }],
		['event_name', { p_event_name: 'x'.repeat(81) }],
		['team_name', { p_team_col_name: ' ' }],
		['teams', { p_team_col_name: ' eagles ' }],
		['team_color', { p_team_row_color: 'green' }],
	])('refuses an invalid %s', async (field, overrides) => {
		expect(await createParty(overrides)).toEqual({ ok: false, error: 'invalid_input', field });
	});
});

describe('host_update_details', () => {
	let party: TestParty;

	async function update(overrides: Record<string, unknown> = {}) {
		const { data, error } = await client.rpc('host_update_details', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_event_name: 'Final',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
			...overrides,
		});
		expect(error).toBeNull();
		return data;
	}

	it('updates the details and returns the party', async () => {
		party = await createTestParty(client);
		created.push(party.id);

		const kickoff = '2027-02-14T23:30:00.000Z';
		const data = await update({ p_event_name: '  Final  ', p_kickoff_at: kickoff });

		expect(data.ok).toBe(true);
		expect(new Date(data.party.expires_at).getTime()).toBeGreaterThanOrEqual(
			new Date(kickoff).getTime() + 14 * 24 * 3600 * 1000
		);
		expect(data.party).toMatchObject({
			event_name: 'Final',
			team_row_name: 'Ravens',
			team_col_name: 'Lions',
		});
	});

	it('uses the same validation as create', async () => {
		party = await createTestParty(client);
		created.push(party.id);

		expect(await update({ p_team_col_name: 'RAVENS' })).toEqual({
			ok: false,
			error: 'invalid_input',
			field: 'teams',
		});
	});

	it('refuses after the grid is locked, and a wrong PIN', async () => {
		party = await createTestParty(client, { status: 'active' });
		created.push(party.id);

		expect(await update()).toEqual({ ok: false, error: 'wrong_status' });
		expect(await update({ p_pin: '9999' })).toEqual({ ok: false, error: 'invalid_pin' });
	});
});
