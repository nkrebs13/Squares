import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
	parseSquare,
	parseParty,
	parseNumbers,
	parseScores,
	parseWinner,
	parseWinnerArray,
	parseGameScores,
} from '$lib/validators/realtime';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
	warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
	warnSpy.mockRestore();
});

const validSquare = {
	id: '11111111-1111-1111-1111-111111111111',
	party_id: '22222222-2222-2222-2222-222222222222',
	row_num: 4,
	col_num: 7,
	player_name: 'Alice',
	player_name_lower: 'alice',
	claimed_at: '2026-04-26T12:00:00Z',
};

const validParty = {
	id: '22222222-2222-2222-2222-222222222222',
	code: 'AB12CD',
	host_name_lower: 'nathan',
	event_name: 'Test Football Squares',
	kickoff_at: null,
	square_price: 1.0,
	split_q1: 25,
	split_q2: 25,
	split_q3: 25,
	split_final: 25,
	status: 'filling',
	team_row_name: 'Patriots',
	team_col_name: 'Eagles',
	team_row_color: '#002244',
	team_col_color: '#004C54',
	created_at: '2026-04-26T00:00:00Z',
	updated_at: '2026-04-26T00:00:00Z',
	expires_at: '2026-05-26T00:00:00Z',
	game_id: null,
	home_team_is_row: null,
};

const validNumbers = {
	party_id: '22222222-2222-2222-2222-222222222222',
	row_numbers: [3, 1, 4, 1, 5, 9, 2, 6, 5, 0],
	col_numbers: [2, 7, 1, 8, 2, 8, 1, 8, 2, 8],
	assigned_at: '2026-04-26T12:00:00Z',
};

const validScores = {
	party_id: '22222222-2222-2222-2222-222222222222',
	q1_row_score: 7,
	q1_col_score: 0,
	q2_row_score: null,
	q2_col_score: null,
	q3_row_score: null,
	q3_col_score: null,
	final_row_score: null,
	final_col_score: null,
};

const validWinner = {
	id: '33333333-3333-3333-3333-333333333333',
	party_id: '22222222-2222-2222-2222-222222222222',
	quarter: 'q1',
	winning_row: 4,
	winning_col: 7,
	player_name: 'Alice',
	amount: 25,
	created_at: '2026-04-26T12:30:00Z',
};

const validGameScores = {
	game_id: 'game-123',
	sport: 'football',
	home_team_abbrev: 'PHI',
	away_team_abbrev: 'NE',
	home_team_name: 'Eagles',
	away_team_name: 'Patriots',
	home_score: 14,
	away_score: 7,
	game_clock: '5:30',
	game_quarter: 2,
	game_status: 'in_progress',
	q1_home: 7,
	q1_away: 0,
	q2_home: 7,
	q2_away: 7,
	q3_home: null,
	q3_away: null,
	q4_home: null,
	q4_away: null,
	final_home: null,
	final_away: null,
	updated_at: '2026-04-26T12:00:00Z',
};

describe('parseSquare', () => {
	it('returns the typed square for a valid payload', () => {
		expect(parseSquare(validSquare)).toEqual(validSquare);
	});

	it('returns null for non-objects', () => {
		expect(parseSquare(null)).toBeNull();
		expect(parseSquare('string')).toBeNull();
		expect(parseSquare(123)).toBeNull();
		expect(parseSquare([])).toBeNull();
	});

	it('returns null when required key is missing', () => {
		const { id: _id, ...missingId } = validSquare;
		expect(parseSquare(missingId)).toBeNull();
	});

	it('returns null when a numeric field is the wrong type', () => {
		expect(parseSquare({ ...validSquare, row_num: '4' })).toBeNull();
	});

	it('accepts null for player_name and claimed_at (unclaimed square)', () => {
		const unclaimed = {
			...validSquare,
			player_name: null,
			player_name_lower: null,
			claimed_at: null,
		};
		expect(parseSquare(unclaimed)).toEqual(unclaimed);
	});

	it('logs a console.warn on failure', () => {
		parseSquare({ id: 'partial' });
		expect(warnSpy).toHaveBeenCalledOnce();
	});
});

describe('parseParty', () => {
	it('returns the typed party for a valid payload', () => {
		expect(parseParty(validParty)).toEqual(validParty);
	});

	it('rejects an unknown status value', () => {
		expect(parseParty({ ...validParty, status: 'archived' })).toBeNull();
	});

	it('passes host_pin through if provided', () => {
		const withPin = { ...validParty, host_pin: '1234' };
		expect(parseParty(withPin)).toEqual(withPin);
	});

	it('returns null when required field is missing', () => {
		const { code: _code, ...missingCode } = validParty;
		expect(parseParty(missingCode)).toBeNull();
	});
});

describe('parseNumbers', () => {
	it('returns the typed numbers for a valid payload', () => {
		expect(parseNumbers(validNumbers)).toEqual(validNumbers);
	});

	it('rejects row_numbers with wrong length', () => {
		expect(parseNumbers({ ...validNumbers, row_numbers: [1, 2, 3] })).toBeNull();
	});

	it('rejects col_numbers with non-number entries', () => {
		expect(
			parseNumbers({ ...validNumbers, col_numbers: ['a', 1, 2, 3, 4, 5, 6, 7, 8, 9] })
		).toBeNull();
	});
});

describe('parseScores', () => {
	it('returns the typed scores for a valid payload', () => {
		expect(parseScores(validScores)).toEqual(validScores);
	});

	it('rejects when a quarter score is the wrong type', () => {
		expect(parseScores({ ...validScores, q1_row_score: '7' })).toBeNull();
	});
});

describe('parseWinner', () => {
	it('returns the typed winner for a valid payload', () => {
		expect(parseWinner(validWinner)).toEqual(validWinner);
	});

	it('rejects an invalid quarter value', () => {
		expect(parseWinner({ ...validWinner, quarter: 'q5' })).toBeNull();
	});

	it('rejects non-object payloads', () => {
		expect(parseWinner(null)).toBeNull();
		expect(parseWinner(42)).toBeNull();
		expect(parseWinner([])).toBeNull();
	});

	it('rejects when required string fields are missing', () => {
		const { id: _id, ...missing } = validWinner;
		expect(parseWinner(missing)).toBeNull();
	});

	it('rejects when winning_row is the wrong type', () => {
		expect(parseWinner({ ...validWinner, winning_row: '4' })).toBeNull();
	});

	it('rejects when winning_col is missing', () => {
		const { winning_col: _wc, ...missing } = validWinner;
		expect(parseWinner(missing)).toBeNull();
	});

	it('rejects when player_name is the wrong type', () => {
		expect(parseWinner({ ...validWinner, player_name: 42 })).toBeNull();
	});

	it('rejects when amount is the wrong type', () => {
		expect(parseWinner({ ...validWinner, amount: 'lots' })).toBeNull();
	});

	it('rejects when created_at is missing', () => {
		const { created_at: _ca, ...missing } = validWinner;
		expect(parseWinner(missing)).toBeNull();
	});

	it('rejects when party_id is missing', () => {
		const { party_id: _pid, ...missing } = validWinner;
		expect(parseWinner(missing)).toBeNull();
	});
});

describe('parseWinnerArray', () => {
	it('returns the typed array for valid input', () => {
		expect(parseWinnerArray([validWinner, validWinner])).toEqual([validWinner, validWinner]);
	});

	it('returns null on non-array input', () => {
		expect(parseWinnerArray(validWinner)).toBeNull();
	});

	it('returns null if any row fails', () => {
		expect(parseWinnerArray([validWinner, { ...validWinner, quarter: 'bogus' }])).toBeNull();
	});

	it('returns empty array for empty input', () => {
		expect(parseWinnerArray([])).toEqual([]);
	});
});

describe('parseGameScores', () => {
	it('returns the typed row for a valid payload', () => {
		expect(parseGameScores(validGameScores)).toEqual(validGameScores);
	});

	it('rejects when a required string field is missing', () => {
		const { game_clock: _gc, ...missing } = validGameScores;
		expect(parseGameScores(missing)).toBeNull();
	});

	it('rejects when a required numeric field is the wrong type', () => {
		expect(parseGameScores({ ...validGameScores, home_score: '14' })).toBeNull();
	});

	it('rejects non-object payloads', () => {
		expect(parseGameScores(null)).toBeNull();
		expect(parseGameScores('string')).toBeNull();
	});

	it('rejects when an optional quarter score is the wrong type', () => {
		expect(parseGameScores({ ...validGameScores, q1_home: 'seven' })).toBeNull();
	});

	it('rejects when game_quarter is missing', () => {
		const { game_quarter: _gq, ...missing } = validGameScores;
		expect(parseGameScores(missing)).toBeNull();
	});

	it('accepts null for optional quarter scores', () => {
		const partial = {
			...validGameScores,
			q1_home: null,
			q1_away: null,
		};
		expect(parseGameScores(partial)).toEqual(partial);
	});
});

describe('additional parseParty branches', () => {
	it('rejects when game_id is the wrong type', () => {
		expect(parseParty({ ...validParty, game_id: 42 })).toBeNull();
	});

	it('rejects when home_team_is_row is the wrong type', () => {
		expect(parseParty({ ...validParty, home_team_is_row: 'yes' })).toBeNull();
	});

	it('rejects when host_name_lower is the wrong type', () => {
		expect(parseParty({ ...validParty, host_name_lower: 42 })).toBeNull();
	});

	it('rejects when event_name is missing', () => {
		const { event_name: _eventName, ...missing } = validParty;
		expect(parseParty(missing)).toBeNull();
	});

	it('rejects when kickoff_at is the wrong type', () => {
		expect(parseParty({ ...validParty, kickoff_at: 42 })).toBeNull();
	});

	it('rejects when team_row_color is missing', () => {
		const { team_row_color: _trc, ...missing } = validParty;
		expect(parseParty(missing)).toBeNull();
	});

	it('rejects non-object payloads', () => {
		expect(parseParty(null)).toBeNull();
		expect(parseParty(undefined)).toBeNull();
		expect(parseParty('not an object')).toBeNull();
	});
});

describe('additional parseScores branches', () => {
	it('rejects non-object payloads', () => {
		expect(parseScores(null)).toBeNull();
	});

	it('rejects when party_id is missing', () => {
		const { party_id: _pid, ...missing } = validScores;
		expect(parseScores(missing)).toBeNull();
	});
});

describe('additional parseNumbers branches', () => {
	it('rejects non-object payloads', () => {
		expect(parseNumbers(null)).toBeNull();
	});

	it('rejects when party_id is missing', () => {
		const { party_id: _pid, ...missing } = validNumbers;
		expect(parseNumbers(missing)).toBeNull();
	});

	it('rejects when assigned_at is missing', () => {
		const { assigned_at: _aa, ...missing } = validNumbers;
		expect(parseNumbers(missing)).toBeNull();
	});

	it('rejects when row_numbers is not an array', () => {
		expect(parseNumbers({ ...validNumbers, row_numbers: 'not array' })).toBeNull();
	});
});
