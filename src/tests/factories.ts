/**
 * Shared test factories. Import from here instead of redefining per test file.
 * A test whose assertions depend on different defaults should pass explicit
 * overrides (or wrap the factory locally) rather than fork the defaults.
 */
import { vi } from 'vitest';
import type { Party, Square, Numbers, Scores, Winner, GameScoresRow } from '$lib/types';

/** A loosely-typed callback captured by a mock (Supabase channel handlers, subscribe callbacks). */
export type MockCallback = (...args: unknown[]) => unknown;

export function createMockParty(overrides: Partial<Party> = {}): Party {
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

export function createMockSquare(
	row: number,
	col: number,
	overrides: Partial<Square> = {}
): Square {
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

export function createEmptyGrid(): Square[] {
	const grid: Square[] = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			grid.push(createMockSquare(row, col));
		}
	}
	return grid;
}

export function createMockNumbers(overrides: Partial<Numbers> = {}): Numbers {
	return {
		party_id: 'test-party-id',
		row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		assigned_at: new Date().toISOString(),
		...overrides,
	};
}

export function createMockScores(overrides: Partial<Scores> = {}): Scores {
	return {
		party_id: 'test-party-id',
		q1_row_score: null,
		q1_col_score: null,
		q2_row_score: null,
		q2_col_score: null,
		q3_row_score: null,
		q3_col_score: null,
		final_row_score: null,
		final_col_score: null,
		...overrides,
	};
}

export function createMockGameScores(overrides: Partial<GameScoresRow> = {}): GameScoresRow {
	return {
		game_id: 'test-game-id',
		sport: 'nfl',
		home_team_abbrev: 'PHI',
		away_team_abbrev: 'KC',
		home_team_name: 'Eagles',
		away_team_name: 'Chiefs',
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

export function createMockWinner(overrides: Partial<Winner> = {}): Winner {
	return {
		id: 'test-winner-id',
		party_id: 'test-party-id',
		quarter: 'q1',
		winning_row: 3,
		winning_col: 7,
		player_name: 'John Doe',
		amount: 250,
		created_at: new Date().toISOString(),
		...overrides,
	};
}

/**
 * A minimal Supabase thenable: invokes the `.then` callback synchronously with
 * `result` and returns `{ catch }`. Cast by the caller's expected type, so it
 * can be passed straight to `mockReturnValue(...)`.
 */
export function mockThenable<T = never>(result: unknown): T {
	return {
		then: (cb: (r: unknown) => void) => {
			cb(result);
			return { catch: vi.fn() };
		},
	} as unknown as T;
}

/**
 * A Supabase thenable whose `.then` callback is captured instead of invoked,
 * so a test can hold the RPC in flight and resolve it later with `resolve()`.
 */
export function mockDeferredThenable<T = never>(): {
	value: T;
	resolve: (result: unknown) => void;
} {
	let cb: ((r: unknown) => void) | null = null;
	const value = {
		then: (fn: (r: unknown) => void) => {
			cb = fn;
			return { catch: vi.fn() };
		},
	} as unknown as T;
	return {
		value,
		resolve: (result) => {
			cb?.(result);
		},
	};
}
