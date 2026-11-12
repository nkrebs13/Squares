import type { Scores } from '$lib/types';

export const QUARTER_KEYS = ['q1', 'q2', 'q3', 'final'] as const;
export type Quarter = (typeof QUARTER_KEYS)[number];

/** A scoring quarter and how the UI names it. Same order as play. */
export interface QuarterInfo {
	key: Quarter;
	/** "Q1" … "Final": payout tables, toasts, the scoreboard. */
	short: string;
	/** "1st Quarter" … "Final": score entry and winner banners. */
	long: string;
	/** "1" … "F": the badge on a winning square. */
	mark: string;
}

export const QUARTERS: readonly QuarterInfo[] = [
	{ key: 'q1', short: 'Q1', long: '1st Quarter', mark: '1' },
	{ key: 'q2', short: 'Q2', long: '2nd Quarter', mark: '2' },
	{ key: 'q3', short: 'Q3', long: '3rd Quarter', mark: '3' },
	{ key: 'final', short: 'Final', long: 'Final', mark: 'F' },
];

export function quarterInfo(key: Quarter): QuarterInfo {
	return QUARTERS.find((q) => q.key === key) ?? QUARTERS[0];
}

/** Order for sorting by quarter (q1 first). */
export function quarterIndex(key: Quarter): number {
	return QUARTERS.findIndex((q) => q.key === key);
}

/** A quarter's recorded row/col score; null while not yet scored. */
export function quarterScore(
	s: Scores | null,
	key: Quarter
): { row: number | null; col: number | null } {
	return { row: s?.[`${key}_row_score`] ?? null, col: s?.[`${key}_col_score`] ?? null };
}

/** The first quarter without a score, or 'final' once all are scored. */
export function nextQuarterToScore(s: Scores | null): Quarter {
	return QUARTERS.find((q) => quarterScore(s, q.key).row === null)?.key ?? 'final';
}

/** The latest quarter with a score, or null before the first one. */
export function latestScoredQuarter(s: Scores | null): Quarter | null {
	return [...QUARTERS].reverse().find((q) => quarterScore(s, q.key).row !== null)?.key ?? null;
}

/**
 * A live game's period number as a label: 1–4 → "Q1"…"Q4", 5 → "OT",
 * 6+ → "2OT"…; below 1 → "".
 */
export function formatGamePeriod(period: number): string {
	if (period < 1) return '';
	if (period <= 4) return `Q${period}`;
	if (period === 5) return 'OT';
	return `${period - 4}OT`;
}
