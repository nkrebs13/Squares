import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	createTestParty,
	ensureSupabaseReady,
	fillAllSquares,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
	lockParty,
	type TestParty,
} from './helpers';

// get_party_state + game_side + the home-team-side trigger (migration 039).
// Test parties are Eagles (row) vs Chiefs (col).

const client = getTestClient();
const service = getServiceRoleClient();
const parties: string[] = [];
const games: string[] = [];

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	for (const id of parties.splice(0)) await forceDeleteParty(id);
	for (const id of games.splice(0)) await service.from('game_scores').delete().eq('game_id', id);
});

async function newParty(): Promise<TestParty> {
	const party = await createTestParty(client);
	parties.push(party.id);
	return party;
}

async function newGame(home: [string, string], away: [string, string], status = 'in_progress') {
	const gameId = `ps-${Math.random().toString(36).slice(2, 10)}`;
	const { error } = await service.from('game_scores').insert({
		game_id: gameId,
		home_team_name: home[0],
		home_team_abbrev: home[1],
		away_team_name: away[0],
		away_team_abbrev: away[1],
		game_status: status,
		home_score: 14,
		away_score: 3,
	});
	if (error) throw error;
	games.push(gameId);
	return gameId;
}

async function state(code: string) {
	const { data, error } = await client.rpc('get_party_state', { p_code: code });
	expect(error).toBeNull();
	return data;
}

describe('get_party_state', () => {
	it('returns the whole party in one read, without the PIN', async () => {
		const party = await newParty();
		await fillAllSquares(client, party.id);
		expect(await lockParty(client, party.id, party.host_pin)).toBe(true);

		const data = await state(party.code.toLowerCase());

		expect(data.party).toMatchObject({ id: party.id, status: 'active' });
		expect(data.party).not.toHaveProperty('host_pin');
		expect(data.party).not.toHaveProperty('pin_attempts');
		expect(data.squares).toHaveLength(100);
		expect(data.squares.slice(0, 2).map((s: { col_num: number }) => s.col_num)).toEqual([0, 1]);
		expect([...data.numbers.row_numbers].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(data.scores.party_id).toBe(party.id);
		expect(data.winners).toEqual([]);
	});

	it('returns null for an unknown code', async () => {
		expect(await state('ZZZZZZ')).toBeNull();
	});

	it('shows an unlinked matching game as live scores only, with the right side', async () => {
		const party = await newParty();
		const gameId = await newGame(['Kansas City Chiefs', 'KC'], ['Philadelphia Eagles', 'PHI']);

		const { game } = await state(party.code);

		expect(game).toMatchObject({ linked: false, home_is_row: false });
		expect(game.row.game_id).toBe(gameId);
	});

	it('ignores finished games and other matchups when nothing is linked', async () => {
		const party = await newParty();
		await newGame(['Philadelphia Eagles', 'PHI'], ['Kansas City Chiefs', 'KC'], 'final');
		await newGame(['Dallas Cowboys', 'DAL'], ['New York Giants', 'NYG']);

		expect((await state(party.code)).game).toBeNull();
	});

	it('returns the linked game, with the side the trigger set', async () => {
		const party = await newParty();
		const gameId = await newGame(
			['Kansas City Chiefs', 'KC'],
			['Philadelphia Eagles', 'PHI'],
			'final'
		);
		const { error } = await service.from('parties').update({ game_id: gameId }).eq('id', party.id);
		if (error) throw error;

		const { game, party: row } = await state(party.code);

		expect(game).toMatchObject({ linked: true, home_is_row: false });
		expect(row.home_team_is_row).toBe(false);
	});
});

describe('game_side via the trigger', () => {
	it.each([
		['full names', ['Philadelphia Eagles', 'PHI'], ['Kansas City Chiefs', 'KC'], true],
		['abbreviations', ['XX', 'KC'], ['YY', 'PHI'], null],
		['row team away', ['Kansas City Chiefs', 'KC'], ['Philadelphia Eagles', 'PHI'], false],
	])('%s', async (_label, home, away, expected) => {
		const party = await newParty();
		const gameId = await newGame(home as [string, string], away as [string, string]);
		await service.from('parties').update({ home_team_is_row: true }).eq('id', party.id);
		await service.from('parties').update({ game_id: gameId }).eq('id', party.id);

		const { data } = await service
			.from('parties')
			.select('home_team_is_row')
			.eq('id', party.id)
			.single();
		// An unmatched game leaves the flag as it was.
		expect(data?.home_team_is_row).toBe(expected ?? true);
	});

	it('treats wildcard characters in team names as literals', async () => {
		const party = await createTestParty(client, { team_row_name: '%' });
		parties.push(party.id);
		const gameId = await newGame(['Philadelphia Eagles', 'PHI'], ['Kansas City Chiefs', 'KC']);
		await service.from('parties').update({ home_team_is_row: false }).eq('id', party.id);
		await service.from('parties').update({ game_id: gameId }).eq('id', party.id);

		const { data } = await service
			.from('parties')
			.select('home_team_is_row')
			.eq('id', party.id)
			.single();
		// '%' as a pattern would match the home team and flip the flag; as a
		// literal it matches nothing, so the flag stays as it was.
		expect(data?.home_team_is_row).toBe(false);
	});

	it('follows a team-name edit on a linked party', async () => {
		const party = await newParty();
		const gameId = await newGame(['Philadelphia Eagles', 'PHI'], ['Kansas City Chiefs', 'KC']);
		await service.from('parties').update({ game_id: gameId }).eq('id', party.id);

		await service
			.from('parties')
			.update({ team_row_name: 'Chiefs', team_col_name: 'Eagles' })
			.eq('id', party.id);

		const { data } = await service
			.from('parties')
			.select('home_team_is_row')
			.eq('id', party.id)
			.single();
		expect(data?.home_team_is_row).toBe(false);
	});

	it('follows the game row when its team names arrive after the link', async () => {
		const party = await newParty();
		const gameId = await newGame(['TBD', 'TBD'], ['TBD', 'TBA']);
		await service.from('parties').update({ game_id: gameId }).eq('id', party.id);

		await service
			.from('game_scores')
			.update({
				home_team_name: 'Kansas City Chiefs',
				home_team_abbrev: 'KC',
				away_team_name: 'Philadelphia Eagles',
				away_team_abbrev: 'PHI',
			})
			.eq('game_id', gameId);

		const { game } = await state(party.code);
		expect(game).toMatchObject({ linked: true, home_is_row: false });
	});
});
