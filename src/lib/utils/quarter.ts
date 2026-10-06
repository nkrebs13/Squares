import type { Quarter, Scores } from '$lib/types';

/**
 * Format quarter number to display label.
 *
 * @param quarter - The quarter number (must be >= 1)
 * @returns Display label:
 *   - Quarter 1-4: "Q1" through "Q4"
 *   - Quarter 5 (first overtime): "OT"
 *   - Quarter 6+: "2OT", "3OT", etc.
 *   - Invalid input (< 1): empty string
 */
export function formatQuarterLabel(quarter: number): string {
	if (quarter < 1) {
		return '';
	}
	if (quarter <= 4) {
		return `Q${quarter}`;
	}
	if (quarter === 5) {
		return 'OT';
	}
	return `${quarter - 4}OT`;
}

/**
 * Determine the next quarter that needs scores entered, from an explicit
 * scores snapshot. Pure so it can be evaluated against reactive store values
 * AND against a freshly-reloaded `get(scores)` snapshot without depending on
 * runes-batch timing. When all four quarters are scored it returns 'final'
 * (never a nonexistent "q5").
 */
export function deriveNextQuarter(s: Scores | null): Quarter {
	if (!s) return 'q1';
	if (s.q1_row_score === null) return 'q1';
	if (s.q2_row_score === null) return 'q2';
	if (s.q3_row_score === null) return 'q3';
	return 'final';
}

/** Committed row/col scores for a quarter from an explicit snapshot (0 when unset). */
export function scoresForQuarter(s: Scores | null, quarter: Quarter): { row: number; col: number } {
	if (!s) return { row: 0, col: 0 };
	switch (quarter) {
		case 'q1':
			return { row: s.q1_row_score ?? 0, col: s.q1_col_score ?? 0 };
		case 'q2':
			return { row: s.q2_row_score ?? 0, col: s.q2_col_score ?? 0 };
		case 'q3':
			return { row: s.q3_row_score ?? 0, col: s.q3_col_score ?? 0 };
		case 'final':
			return { row: s.final_row_score ?? 0, col: s.final_col_score ?? 0 };
	}
}
