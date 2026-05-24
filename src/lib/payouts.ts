import type { Quarter } from '$lib/types';

export type PayoutSplits = Record<Quarter, number>;

export interface PayoutRow {
	key: Quarter;
	label: string;
	percent: number;
	amount: number;
}

const PAYOUT_QUARTERS: Array<{ key: Quarter; label: string }> = [
	{ key: 'q1', label: 'Q1' },
	{ key: 'q2', label: 'Q2' },
	{ key: 'q3', label: 'Q3' },
	{ key: 'final', label: 'Final' },
];

function roundCurrency(amount: number): number {
	return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateTotalPot(squarePrice: number, squareCount = 100): number {
	return roundCurrency(squarePrice * squareCount);
}

export function calculatePayoutAmount(totalPot: number, percent: number): number {
	return roundCurrency((totalPot * percent) / 100);
}

export function buildPayoutRows(splits: PayoutSplits, totalPot: number): PayoutRow[] {
	return PAYOUT_QUARTERS.map(({ key, label }) => ({
		key,
		label,
		percent: splits[key],
		amount: calculatePayoutAmount(totalPot, splits[key]),
	}));
}
