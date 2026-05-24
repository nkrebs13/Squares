import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { loadParty, party, numbers, gameScores, isLoading, error, cleanup } from '$lib/stores/game';
import { gameScoresMatchParty } from '$lib/stores/game-state';
import type { GameScoresRow, Party } from '$lib/types';
import { mockSupabaseClient } from '../setup';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
		event_name: 'Test Football Squares',
		kickoff_at: null,
		square_price: 10,
		split_q1: 25,
		split_q2: 25,
		split_q3: 25,
		split_final: 25,
		status: 'filling',
		team_row_name: 'Eagles',
		team_col_name: 'Chiefs',
		team_row_color: '#004C54',
		team_col_color: '#E31837',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		game_id: null,
		home_team_is_row: null,
		...overrides,
	};
}

// Reusable chain creators
function makeQueryChain(resolveData: unknown, resolveError: unknown = null) {
	return {
		select: vi.fn().mockReturnThis(),
		insert: vi.fn().mockReturnThis(),
		update: vi.fn().mockReturnThis(),
		delete: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		neq: vi.fn().mockReturnThis(),
		limit: vi.fn().mockReturnThis(),
		order: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data: resolveData, error: resolveError }),
		maybeSingle: vi.fn().mockResolvedValue({ data: resolveData, error: resolveError }),
		then: vi.fn(),
	};
}

function makeGameScoresRow(overrides: Partial<GameScoresRow> = {}): GameScoresRow {
	return {
		game_id: 'test-game',
		sport: 'nfl',
		home_team_abbrev: 'PHI',
		away_team_abbrev: 'KC',
		home_team_name: 'Philadelphia Eagles',
		away_team_name: 'Kansas City Chiefs',
		home_score: 0,
		away_score: 0,
		game_clock: '',
		game_quarter: 0,
		game_status: 'pregame',
		q1_home: null,
		q1_away: null,
		q2_home: null,
		q2_away: null,
		q3_home: null,
		q3_away: null,
		q4_home: null,
		q4_away: null,
		final_home: null,
		final_away: null,
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

function makeListQueryChain(resolveData: unknown[] | null, resolveError: unknown = null) {
	const chain = makeQueryChain(null);
	chain.limit.mockResolvedValue({ data: resolveData, error: resolveError });
	return chain;
}

function makeSquaresChain(data: unknown[] = []) {
	const chain = makeQueryChain(null);
	chain.order
		.mockReturnValueOnce(chain) // .order('row_num')
		.mockResolvedValueOnce({ data, error: null }); // .order('col_num')
	return chain;
}

function makeWinnersChain(data: unknown[] = []) {
	const chain = makeQueryChain(null);
	chain.order.mockResolvedValue({ data, error: null });
	return chain;
}

describe('loadParty branches', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	describe('gameScoresMatchParty', () => {
		it('matches full names, short names, and abbreviations across home/away ordering', () => {
			const game = makeGameScoresRow();

			expect(gameScoresMatchParty(game, createMockParty())).toBe(true);
			expect(
				gameScoresMatchParty(game, createMockParty({ team_row_name: 'KC', team_col_name: 'PHI' }))
			).toBe(true);
			expect(
				gameScoresMatchParty(
					game,
					createMockParty({ team_row_name: 'Ravens', team_col_name: 'Lions' })
				)
			).toBe(false);
		});
	});

	it('skips numbers fetch when party status is filling', async () => {
		const mockParty = createMockParty({ status: 'filling' });

		// Calls: parties, game_scores(auto-detect), squares, scores, winners
		// (no numbers because filling, no game_scores fetch because no game found)
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>) // parties
			.mockReturnValueOnce(makeListQueryChain([]) as ReturnType<typeof mockSupabaseClient.from>) // auto-detect (no game found)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>) // squares
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>); // winners

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(numbers)).toBeNull();
	});

	it('skips auto-detect when party has a game_id', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: 'existing-game-id',
			home_team_is_row: true, // matches what resolveHomeIsRow returns, so no correction
		});

		const mockGameScoresData = {
			game_id: 'existing-game-id',
			sport: 'nfl',
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
			home_score: 14,
			away_score: 7,
			game_clock: '5:30',
			game_quarter: 2,
			game_status: 'in_progress',
			q1_home: 7,
			q1_away: 3,
			q2_home: null,
			q2_away: null,
			q3_home: null,
			q3_away: null,
			q4_home: null,
			q4_away: null,
			final_home: null,
			final_away: null,
			updated_at: new Date().toISOString(),
		};

		// Calls: parties, squares, numbers, scores, game_scores, winners
		// (no auto-detect because party has game_id)
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(
				makeQueryChain(mockGameScoresData) as ReturnType<typeof mockSupabaseClient.from>
			)
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(gameScores)).toEqual(mockGameScoresData);
	});

	it('auto-detects active game when party has no game_id', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: null,
			home_team_is_row: true, // will match resolveHomeIsRow result
		});
		const autoDetectedGameId = 'auto-detected-game-id';
		const mockGameScoresData = makeGameScoresRow({
			game_id: autoDetectedGameId,
		});

		// Calls: parties, auto-detect, squares, numbers, scores, winners.
		// The matched auto-detect row is reused as game_scores.
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(
				makeListQueryChain([mockGameScoresData]) as ReturnType<typeof mockSupabaseClient.from>
			) // auto-detect
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		const loadedParty = get(party);
		expect(loadedParty?.game_id).toBe(autoDetectedGameId);
		expect(get(gameScores)?.game_id).toBe(autoDetectedGameId);
	});

	it('does not auto-detect an unrelated active game', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: null,
			team_row_name: 'Ravens',
			team_col_name: 'Lions',
		});
		const unrelatedGame = makeGameScoresRow({
			game_id: 'eagles-chiefs-game',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
		});

		// Calls: parties, auto-detect(no matching game), squares, numbers, scores, winners
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(
				makeListQueryChain([unrelatedGame]) as ReturnType<typeof mockSupabaseClient.from>
			)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(party)?.game_id).toBeNull();
		expect(get(gameScores)).toBeNull();
	});

	it('sets gameScores to null when no effectiveGameId', async () => {
		const mockParty = createMockParty({ status: 'filling', game_id: null });

		// Calls: parties, auto-detect(no game), squares, scores, winners
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeListQueryChain([]) as ReturnType<typeof mockSupabaseClient.from>) // auto-detect: no game
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(gameScores)).toBeNull();
	});

	it('handles game scores PGRST116 error gracefully', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: 'test-game',
			home_team_is_row: true,
		});

		// Calls: parties, squares, numbers, scores, game_scores(PGRST116 error), winners
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(
				makeQueryChain(null, { message: 'No rows returned', code: 'PGRST116' }) as ReturnType<
					typeof mockSupabaseClient.from
				>
			)
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(gameScores)).toBeNull();
	});

	it('handles non-PGRST116 game scores error gracefully', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: 'test-game',
			home_team_is_row: true,
		});

		// Calls: parties, squares, numbers, scores, game_scores(non-PGRST error), winners
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(
				makeQueryChain(null, { message: 'Database error', code: 'PGRST500' }) as ReturnType<
					typeof mockSupabaseClient.from
				>
			)
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(gameScores)).toBeNull();
	});

	it('corrects home_team_is_row when game scores indicate different mapping', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: 'test-game',
			team_row_name: 'Eagles',
			team_col_name: 'Chiefs',
			home_team_is_row: false, // incorrect — Eagles are the home team, resolveHomeIsRow returns true
		});

		const mockGameScoresData = {
			game_id: 'test-game',
			sport: 'nfl',
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
			home_score: 14,
			away_score: 7,
			game_clock: '5:30',
			game_quarter: 2,
			game_status: 'in_progress',
			q1_home: 7,
			q1_away: 3,
			q2_home: null,
			q2_away: null,
			q3_home: null,
			q3_away: null,
			q4_home: null,
			q4_away: null,
			final_home: null,
			final_away: null,
			updated_at: new Date().toISOString(),
		};

		// Calls: parties, [squares, numbers, scores, game_scores, winners] via Promise.all,
		// then parties(update) fire-and-forget after Promise.all resolves
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(
				makeQueryChain(mockGameScoresData) as ReturnType<typeof mockSupabaseClient.from>
			) // game_scores
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>) // winners
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>); // parties update (fire-and-forget)

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		const loadedParty = get(party);
		expect(loadedParty?.home_team_is_row).toBe(true);
	});

	it('does not correct home_team_is_row when it already matches', async () => {
		const mockParty = createMockParty({
			status: 'active',
			game_id: 'test-game',
			team_row_name: 'Eagles',
			team_col_name: 'Chiefs',
			home_team_is_row: true, // already correct
		});

		const mockGameScoresData = {
			game_id: 'test-game',
			sport: 'nfl',
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
			home_score: 0,
			away_score: 0,
			game_clock: '',
			game_quarter: 0,
			game_status: 'pregame',
			q1_home: null,
			q1_away: null,
			q2_home: null,
			q2_away: null,
			q3_home: null,
			q3_away: null,
			q4_home: null,
			q4_away: null,
			final_home: null,
			final_away: null,
			updated_at: new Date().toISOString(),
		};

		// Calls: parties, squares, numbers, scores, game_scores, winners
		// (no correction because home_team_is_row already correct)
		mockSupabaseClient.from
			.mockReturnValueOnce(makeQueryChain(mockParty) as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeSquaresChain() as ReturnType<typeof mockSupabaseClient.from>)
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(makeQueryChain(null) as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(
				makeQueryChain(mockGameScoresData) as ReturnType<typeof mockSupabaseClient.from>
			) // game_scores
			.mockReturnValueOnce(makeWinnersChain() as ReturnType<typeof mockSupabaseClient.from>);

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		const loadedParty = get(party);
		expect(loadedParty?.home_team_is_row).toBe(true);
	});

	it('handles exception in try block gracefully and preserves the underlying error message', async () => {
		mockSupabaseClient.from.mockImplementationOnce(() => {
			throw new Error('Network failure');
		});

		const result = await loadParty('TEST123');

		expect(result).toBe(false);
		expect(get(error)).toMatch(/Couldn't load that party/);
		expect(get(isLoading)).toBe(false);
	});
});
