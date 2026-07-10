import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	leadingSquare,
	party,
	numbers,
	gameScores,
	squareKey,
	cleanup,
	squares,
	selectedPlayerFilter,
	removePlayer,
} from '$lib/stores/game';
import { resolveHomeIsRow } from '$lib/stores/game-state';
import type { Party, Numbers, GameScoresRow, Square } from '$lib/types';
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

function createMockSquare(row: number, col: number, overrides: Partial<Square> = {}): Square {
	return {
		id: `sq-${row}-${col}`,
		party_id: 'test-party-id',
		row_num: row,
		col_num: col,
		player_name: null,
		player_name_lower: null,
		claimed_at: null,
		...overrides,
	};
}

function createMockNumbers(overrides: Partial<Numbers> = {}): Numbers {
	return {
		party_id: 'test-party-id',
		row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		assigned_at: new Date().toISOString(),
		...overrides,
	};
}

function createMockGameScores(overrides: Partial<GameScoresRow> = {}): GameScoresRow {
	return {
		game_id: 'test-game-id',
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

describe('resolveHomeIsRow', () => {
	it('returns true when home team matches row team (home includes row)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
		});
		const p = createMockParty({ team_row_name: 'Eagles', team_col_name: 'Chiefs' });
		expect(resolveHomeIsRow(gs, p)).toBe(true);
	});

	it('returns true when home team matches row team (row includes home)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Eagles',
			away_team_name: 'Chiefs',
		});
		const p = createMockParty({
			team_row_name: 'Philadelphia Eagles',
			team_col_name: 'Kansas City Chiefs',
		});
		expect(resolveHomeIsRow(gs, p)).toBe(true);
	});

	it('returns false when away team matches row team (away includes row)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Kansas City Chiefs',
			away_team_name: 'Philadelphia Eagles',
		});
		const p = createMockParty({ team_row_name: 'Eagles', team_col_name: 'Chiefs' });
		expect(resolveHomeIsRow(gs, p)).toBe(false);
	});

	it('returns false when away team matches row team (row includes away)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Chiefs',
			away_team_name: 'Eagles',
		});
		const p = createMockParty({
			team_row_name: 'Philadelphia Eagles',
			team_col_name: 'Kansas City Chiefs',
		});
		expect(resolveHomeIsRow(gs, p)).toBe(false);
	});

	it('returns false when home team matches col team (home includes col)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Kansas City Chiefs',
			away_team_name: 'Seattle Seahawks',
		});
		const p = createMockParty({ team_row_name: 'Packers', team_col_name: 'Chiefs' });
		expect(resolveHomeIsRow(gs, p)).toBe(false);
	});

	it('returns true when away team matches col team (away includes col)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Seattle Seahawks',
			away_team_name: 'Kansas City Chiefs',
		});
		const p = createMockParty({ team_row_name: 'Packers', team_col_name: 'Chiefs' });
		expect(resolveHomeIsRow(gs, p)).toBe(true);
	});

	it('falls back to home_team_is_row when no name match (true)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Team Alpha',
			away_team_name: 'Team Bravo',
		});
		const p = createMockParty({
			team_row_name: 'Xylophone',
			team_col_name: 'Zephyr',
			home_team_is_row: true,
		});
		expect(resolveHomeIsRow(gs, p)).toBe(true);
	});

	it('falls back to home_team_is_row when no name match (false)', () => {
		const gs = createMockGameScores({
			home_team_name: 'Team Alpha',
			away_team_name: 'Team Bravo',
		});
		const p = createMockParty({
			team_row_name: 'Xylophone',
			team_col_name: 'Zephyr',
			home_team_is_row: false,
		});
		expect(resolveHomeIsRow(gs, p)).toBe(false);
	});

	it('falls back to true when home_team_is_row is null and no name match', () => {
		const gs = createMockGameScores({
			home_team_name: 'Team Alpha',
			away_team_name: 'Team Bravo',
		});
		const p = createMockParty({
			team_row_name: 'Xylophone',
			team_col_name: 'Zephyr',
			home_team_is_row: null,
		});
		expect(resolveHomeIsRow(gs, p)).toBe(true);
	});

	it('is case-insensitive', () => {
		const gs = createMockGameScores({
			home_team_name: 'PHILADELPHIA EAGLES',
			away_team_name: 'KANSAS CITY CHIEFS',
		});
		const p = createMockParty({ team_row_name: 'eagles', team_col_name: 'chiefs' });
		expect(resolveHomeIsRow(gs, p)).toBe(true);
	});
});

describe('leadingSquare derived store', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns null when liveScores is null', () => {
		party.set(createMockParty({ status: 'active' }));
		numbers.set(createMockNumbers());
		gameScores.set(null);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when numbers is null', () => {
		party.set(createMockParty({ status: 'active' }));
		numbers.set(null);
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when party is null', () => {
		party.set(null);
		numbers.set(createMockNumbers());
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when party status is filling', () => {
		party.set(
			createMockParty({ status: 'filling', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		numbers.set(createMockNumbers());
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when party status is complete', () => {
		party.set(
			createMockParty({ status: 'complete', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		numbers.set(createMockNumbers());
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when game status is final', () => {
		party.set(
			createMockParty({ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		numbers.set(createMockNumbers());
		gameScores.set(createMockGameScores({ home_score: 14, away_score: 7, game_status: 'final' }));
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when game status is pregame', () => {
		party.set(
			createMockParty({ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		numbers.set(createMockNumbers());
		gameScores.set(createMockGameScores({ home_score: 0, away_score: 0, game_status: 'pregame' }));
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when row digit not found in numbers', () => {
		party.set(
			createMockParty({ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		// Row numbers don't contain 4 (last digit of 14)
		numbers.set(createMockNumbers({ row_numbers: [0, 1, 2, 3, 5, 6, 7, 8, 9, 0] }));
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when col digit not found in numbers', () => {
		party.set(
			createMockParty({ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		// Col numbers don't contain 7 (last digit of 7)
		numbers.set(createMockNumbers({ col_numbers: [0, 1, 2, 3, 4, 5, 6, 8, 9, 0] }));
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns correct leading square for active party', () => {
		party.set(
			createMockParty({ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		numbers.set(createMockNumbers());
		// Home (Eagles/row) score 14 → last digit 4, Away (Chiefs/col) score 7 → last digit 7
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		const result = get(leadingSquare);
		expect(result).toEqual({ row: 4, col: 7 });
	});

	it('returns correct leading square for locked party', () => {
		party.set(
			createMockParty({ status: 'locked', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		numbers.set(createMockNumbers());
		gameScores.set(
			createMockGameScores({ home_score: 21, away_score: 10, game_status: 'in_progress' })
		);
		const result = get(leadingSquare);
		// home_score 21 → digit 1, away_score 10 → digit 0
		expect(result).toEqual({ row: 1, col: 0 });
	});

	it('uses shuffled numbers correctly', () => {
		party.set(
			createMockParty({ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' })
		);
		// Shuffled: digit 4 is at index 8, digit 7 is at index 2
		numbers.set(
			createMockNumbers({
				row_numbers: [9, 8, 7, 6, 5, 3, 2, 1, 4, 0],
				col_numbers: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
			})
		);
		gameScores.set(
			createMockGameScores({ home_score: 14, away_score: 7, game_status: 'in_progress' })
		);
		const result = get(leadingSquare);
		// row digit 4 is at index 8, col digit 7 is at index 2
		expect(result).toEqual({ row: 8, col: 2 });
	});
});

describe('squareKey', () => {
	it('creates key from row and col', () => {
		expect(squareKey(0, 0)).toBe('0-0');
		expect(squareKey(5, 3)).toBe('5-3');
		expect(squareKey(9, 9)).toBe('9-9');
	});
});

describe('selectedPlayerFilter self-clearing (Bug 3 regression)', () => {
	beforeEach(() => {
		cleanup();
		selectedPlayerFilter.set(null);
	});

	it('clears the filter when the last matching square is unclaimed directly on the squares store', () => {
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		selectedPlayerFilter.set('alice');
		expect(get(selectedPlayerFilter)).toBe('alice');

		// Mirrors what unclaimSquareOptimistic / applySquareUpdate do to squares
		// when a player's last square is unclaimed.
		squares.update((current) =>
			current.map((s) =>
				s.row_num === 0 && s.col_num === 0
					? { ...s, player_name: null, player_name_lower: null }
					: s
			)
		);

		expect(get(selectedPlayerFilter)).toBeNull();
	});

	it('clears the filter when removePlayer bulk-clears the filtered players squares', async () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		selectedPlayerFilter.set('alice');
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 1, error: null });

		await removePlayer('1234', 'alice');

		expect(get(selectedPlayerFilter)).toBeNull();
	});

	it('leaves an unrelated filter untouched when a different player is removed', async () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' }),
			createMockSquare(0, 1, { player_name: 'Bob', player_name_lower: 'bob' }),
		]);
		selectedPlayerFilter.set('bob');
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 1, error: null });

		await removePlayer('1234', 'alice');

		expect(get(selectedPlayerFilter)).toBe('bob');
	});

	it('leaves the filter untouched while the filtered player still has other squares remaining', () => {
		squares.set([
			createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' }),
			createMockSquare(0, 1, { player_name: 'Alice', player_name_lower: 'alice' }),
		]);
		selectedPlayerFilter.set('alice');

		squares.update((current) =>
			current.map((s) =>
				s.row_num === 0 && s.col_num === 0
					? { ...s, player_name: null, player_name_lower: null }
					: s
			)
		);

		expect(get(selectedPlayerFilter)).toBe('alice');
	});

	it('does not touch the filter when it is already null', () => {
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		expect(get(selectedPlayerFilter)).toBeNull();

		squares.set([]);

		expect(get(selectedPlayerFilter)).toBeNull();
	});
});
