import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	createTestParty,
	ensureSupabaseReady,
	fillAllSquares,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
	lockParty,
	type TestParty,
	getTestDatabaseUrl,
} from './helpers';

// One scoring path (migration 037): host_record_score and the live
// game_scores trigger both go through record_quarter_score.

const client = getTestClient();
const service = getServiceRoleClient();
const createdParties: string[] = [];
const createdGames: string[] = [];

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	for (const id of createdParties.splice(0)) await forceDeleteParty(id);
	for (const id of createdGames.splice(0))
		await service.from('game_scores').delete().eq('game_id', id);
});

async function runningParty(
	overrides: { square_price?: number; team_row_name?: string; team_col_name?: string } = {}
): Promise<TestParty> {
	const party = await createTestParty(client, overrides);
	createdParties.push(party.id);
	await fillAllSquares(party.id);
	expect(await lockParty(client, party.id, party.host_pin)).toBe(true);
	return party;
}

async function numbersOf(partyId: string) {
	const { data } = await client
		.from('numbers')
		.select('row_numbers, col_numbers')
		.eq('party_id', partyId)
		.single();
	return data as { row_numbers: number[]; col_numbers: number[] };
}

function record(party: TestParty, quarter: string, row: number, col: number, pin = party.host_pin) {
	return client.rpc('host_record_score', {
		p_party_id: party.id,
		p_pin: pin,
		p_quarter: quarter,
		p_row_score: row,
		p_col_score: col,
	});
}

describe('host_record_score', () => {
	it('records the score and the owner of the winning square, with the payout', async () => {
		const party = await runningParty({ square_price: 2 });
		const numbers = await numbersOf(party.id);

		const { data, error } = await record(party, 'q2', 17, 23);

		expect(error).toBeNull();
		expect(data.ok).toBe(true);
		const row = numbers.row_numbers.indexOf(7);
		const col = numbers.col_numbers.indexOf(3);
		expect(data.scores).toMatchObject({ q2_row_score: 17, q2_col_score: 23 });
		expect(data.winners).toEqual([
			expect.objectContaining({
				quarter: 'q2',
				winning_row: row,
				winning_col: col,
				player_name: `Player-R${row}C${col}`,
				amount: 50,
			}),
		]);
		expect(data.party.status).toBe('active');
	});

	it('re-scoring a quarter replaces its winner', async () => {
		const party = await runningParty();
		await record(party, 'q1', 0, 0);
		const { data } = await record(party, 'q1', 1, 1);

		expect(data.winners).toHaveLength(1);
		expect(data.scores).toMatchObject({ q1_row_score: 1, q1_col_score: 1 });
	});

	it('completes the game on the final score', async () => {
		const party = await runningParty();
		const { data } = await record(party, 'final', 24, 21);
		expect(data.party.status).toBe('complete');
	});

	it.each([
		['a negative score', 'q1', -1, 3],
		['an unknown quarter', 'q4', 7, 3],
	])('refuses %s', async (_label, quarter, row, col) => {
		const party = await runningParty();
		const { data } = await record(party, quarter, row, col);
		expect(data).toEqual({ ok: false, error: 'invalid_input', field: 'score' });
	});

	it('refuses before the game starts and after it ends, and a wrong PIN', async () => {
		const filling = await createTestParty(client);
		createdParties.push(filling.id);
		expect((await record(filling, 'q1', 7, 3)).data).toEqual({ ok: false, error: 'wrong_status' });

		const party = await runningParty();
		await record(party, 'final', 7, 3);
		expect((await record(party, 'q1', 7, 3)).data).toEqual({ ok: false, error: 'wrong_status' });
		expect((await record(party, 'q1', 7, 3, '9999')).data).toEqual({
			ok: false,
			error: 'invalid_pin',
		});
	});

	it('rolls the whole score back when the winning square has no owner', async () => {
		const party = await runningParty();
		const numbers = await numbersOf(party.id);
		await service
			.from('squares')
			.update({ player_name: null })
			.eq('party_id', party.id)
			.eq('row_num', numbers.row_numbers.indexOf(7))
			.eq('col_num', numbers.col_numbers.indexOf(3));

		const { error } = await record(party, 'q1', 7, 3);

		expect(error).not.toBeNull();
		const { data: scores } = await client
			.from('scores')
			.select('q1_row_score')
			.eq('party_id', party.id)
			.single();
		expect(scores?.q1_row_score).toBeNull();
	});
});

describe('live scores (game_scores trigger)', () => {
	it('a broken party does not stop the others from scoring', async () => {
		const gameId = `rs-${Date.now()}`;
		const game = await service.from('game_scores').insert({
			game_id: gameId,
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Eagles',
			away_team_name: 'Chiefs',
		});
		if (game.error) throw game.error;
		createdGames.push(gameId);

		const healthy = await runningParty();
		const broken = await runningParty();
		for (const p of [healthy, broken]) {
			await service.from('parties').update({ game_id: gameId }).eq('id', p.id);
		}
		await service.from('squares').update({ player_name: null }).eq('party_id', broken.id);

		const { error } = await service
			.from('game_scores')
			.update({ q1_home: 7, q1_away: 3 })
			.eq('game_id', gameId);

		expect(error).toBeNull();
		const winnersOf = async (id: string) =>
			(await client.from('winners').select('quarter').eq('party_id', id)).data;
		expect(await winnersOf(healthy.id)).toEqual([{ quarter: 'q1' }]);
		expect(await winnersOf(broken.id)).toEqual([]);
		const { data: brokenScores } = await client
			.from('scores')
			.select('q1_row_score')
			.eq('party_id', broken.id)
			.single();
		expect(brokenScores?.q1_row_score).toBeNull();
	});

	async function newGame(scores: Record<string, number> = {}): Promise<string> {
		const gameId = `rs${Date.now() % 1e9}${Math.random().toString(36).slice(2, 6)}`;
		const { error } = await service.from('game_scores').insert({
			game_id: gameId,
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
			...scores,
		});
		if (error) throw error;
		createdGames.push(gameId);
		return gameId;
	}

	async function scoresOf(partyId: string) {
		const { data } = await client
			.from('scores')
			.select('q1_row_score, q1_col_score, q2_row_score, q2_col_score, q3_row_score')
			.eq('party_id', partyId)
			.single();
		return data;
	}

	it('puts the home score on whichever side is the home team', async () => {
		// Home team (Eagles) is the column here.
		const party = await runningParty({ team_row_name: 'Chiefs', team_col_name: 'Eagles' });
		const gameId = await newGame();
		await service.from('parties').update({ game_id: gameId }).eq('id', party.id);

		await service.from('game_scores').update({ q1_home: 7, q1_away: 3 }).eq('game_id', gameId);

		expect(await scoresOf(party.id)).toMatchObject({ q1_row_score: 3, q1_col_score: 7 });
	});

	it('the backfill applies every quarter already scored to a party linked late', async () => {
		const party = await runningParty({ team_row_name: 'Eagles', team_col_name: 'Chiefs' });
		const gameId = await newGame({ q1_home: 7, q1_away: 3, q2_home: 14, q2_away: 10 });
		await service.from('parties').update({ game_id: gameId }).eq('id', party.id);
		expect(await scoresOf(party.id)).toMatchObject({ q1_row_score: null });

		const { error } = await service.rpc('backfill_party_scores', { p_party_id: party.id });
		expect(error).toBeNull();

		expect(await scoresOf(party.id)).toMatchObject({
			q1_row_score: 7,
			q1_col_score: 3,
			q2_row_score: 14,
			q2_col_score: 10,
			q3_row_score: null,
		});
		const { data: winners } = await client
			.from('winners')
			.select('quarter')
			.eq('party_id', party.id)
			.order('quarter');
		expect(winners?.map((w) => w.quarter)).toEqual(['q1', 'q2']);
	});

	it('a party deleted mid-update is skipped, not an error', async () => {
		const db = new pg.Client({
			connectionString: getTestDatabaseUrl(),
		});
		await db.connect();
		try {
			const { rows } = await db.query(
				"SELECT auto_update_score(gen_random_uuid(), 'q1', 7, 3) AS scored"
			);
			expect(rows[0].scored).toBe(false);
		} finally {
			await db.end();
		}
	});
});
