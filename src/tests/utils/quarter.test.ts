import { describe, it, expect } from 'vitest';
import { deriveNextQuarter, formatQuarterLabel, scoresForQuarter } from '$lib/utils/quarter';
import type { Scores } from '$lib/types';

describe('formatQuarterLabel', () => {
	it('returns Q1-Q4 for quarters 1-4', () => {
		expect(formatQuarterLabel(1)).toBe('Q1');
		expect(formatQuarterLabel(2)).toBe('Q2');
		expect(formatQuarterLabel(3)).toBe('Q3');
		expect(formatQuarterLabel(4)).toBe('Q4');
	});

	it('returns OT for quarter 5', () => {
		expect(formatQuarterLabel(5)).toBe('OT');
	});

	it('returns 2OT, 3OT, etc. for quarters 6+', () => {
		expect(formatQuarterLabel(6)).toBe('2OT');
		expect(formatQuarterLabel(7)).toBe('3OT');
		expect(formatQuarterLabel(8)).toBe('4OT');
	});

	it('returns empty string for invalid inputs (quarter < 1)', () => {
		expect(formatQuarterLabel(0)).toBe('');
		expect(formatQuarterLabel(-1)).toBe('');
		expect(formatQuarterLabel(-5)).toBe('');
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

describe('deriveNextQuarter', () => {
	it('returns q1 when there are no scores', () => {
		expect(deriveNextQuarter(null)).toBe('q1');
		expect(deriveNextQuarter(makeScores())).toBe('q1');
	});

	it('returns the first quarter without a row score', () => {
		expect(deriveNextQuarter(makeScores({ q1_row_score: 7 }))).toBe('q2');
		expect(deriveNextQuarter(makeScores({ q1_row_score: 7, q2_row_score: 14 }))).toBe('q3');
	});

	it('parks on final once q1-q3 are scored, never a nonexistent q5', () => {
		const scored = makeScores({ q1_row_score: 7, q2_row_score: 14, q3_row_score: 21 });
		expect(deriveNextQuarter(scored)).toBe('final');
		expect(deriveNextQuarter({ ...scored, final_row_score: 28 })).toBe('final');
	});
});

describe('scoresForQuarter', () => {
	it('returns zeros for a null snapshot', () => {
		expect(scoresForQuarter(null, 'q2')).toEqual({ row: 0, col: 0 });
	});

	it('returns committed scores for each quarter', () => {
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
		expect(scoresForQuarter(s, 'q1')).toEqual({ row: 1, col: 2 });
		expect(scoresForQuarter(s, 'q2')).toEqual({ row: 3, col: 4 });
		expect(scoresForQuarter(s, 'q3')).toEqual({ row: 5, col: 6 });
		expect(scoresForQuarter(s, 'final')).toEqual({ row: 7, col: 8 });
	});

	it('treats unset quarter scores as zero', () => {
		expect(scoresForQuarter(makeScores(), 'q3')).toEqual({ row: 0, col: 0 });
	});
});
