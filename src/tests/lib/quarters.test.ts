import { describe, it, expect } from 'vitest';
import {
	QUARTERS,
	formatGamePeriod,
	latestScoredQuarter,
	nextQuarterToScore,
	quarterIndex,
	quarterScore,
} from '$lib/quarters';
import type { Scores } from '$lib/types';

describe('formatGamePeriod', () => {
	it('returns Q1-Q4 for quarters 1-4', () => {
		expect(formatGamePeriod(1)).toBe('Q1');
		expect(formatGamePeriod(2)).toBe('Q2');
		expect(formatGamePeriod(3)).toBe('Q3');
		expect(formatGamePeriod(4)).toBe('Q4');
	});

	it('returns OT for quarter 5', () => {
		expect(formatGamePeriod(5)).toBe('OT');
	});

	it('returns 2OT, 3OT, etc. for quarters 6+', () => {
		expect(formatGamePeriod(6)).toBe('2OT');
		expect(formatGamePeriod(7)).toBe('3OT');
		expect(formatGamePeriod(8)).toBe('4OT');
	});

	it('returns empty string for invalid inputs (quarter < 1)', () => {
		expect(formatGamePeriod(0)).toBe('');
		expect(formatGamePeriod(-1)).toBe('');
		expect(formatGamePeriod(-5)).toBe('');
	});
});

function makeScores(overrides: Partial<Scores> = {}): Scores {
	return {
		party_id: 'p',
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

describe('nextQuarterToScore', () => {
	it('returns q1 when there are no scores', () => {
		expect(nextQuarterToScore(null)).toBe('q1');
		expect(nextQuarterToScore(makeScores())).toBe('q1');
	});

	it('returns the first quarter without a row score', () => {
		expect(nextQuarterToScore(makeScores({ q1_row_score: 7 }))).toBe('q2');
		expect(nextQuarterToScore(makeScores({ q1_row_score: 7, q2_row_score: 14 }))).toBe('q3');
	});

	it('parks on final once q1-q3 are scored, never a nonexistent q5', () => {
		const scored = makeScores({ q1_row_score: 7, q2_row_score: 14, q3_row_score: 21 });
		expect(nextQuarterToScore(scored)).toBe('final');
		expect(nextQuarterToScore({ ...scored, final_row_score: 28 })).toBe('final');
	});
});

describe('quarterScore', () => {
	it('is null for a missing snapshot or an unscored quarter', () => {
		expect(quarterScore(null, 'q2')).toEqual({ row: null, col: null });
		expect(quarterScore(makeScores(), 'q3')).toEqual({ row: null, col: null });
	});

	it("reads each quarter's committed scores", () => {
		const s = makeScores({
			q1_row_score: 1,
			q1_col_score: 2,
			q2_row_score: 3,
			q2_col_score: 4,
			q3_row_score: 5,
			q3_col_score: 6,
			final_row_score: 7,
			final_col_score: 8,
		});
		expect(QUARTERS.map((q) => quarterScore(s, q.key))).toEqual([
			{ row: 1, col: 2 },
			{ row: 3, col: 4 },
			{ row: 5, col: 6 },
			{ row: 7, col: 8 },
		]);
	});
});

describe('latestScoredQuarter', () => {
	it('is the last quarter with a score', () => {
		expect(latestScoredQuarter(null)).toBeNull();
		expect(latestScoredQuarter(makeScores({ q1_row_score: 7, q2_row_score: 14 }))).toBe('q2');
	});
});

describe('QUARTERS', () => {
	it('lists the quarters in play order', () => {
		expect(QUARTERS.map((q) => q.key)).toEqual(['q1', 'q2', 'q3', 'final']);
		expect(quarterIndex('final')).toBe(3);
	});
});
