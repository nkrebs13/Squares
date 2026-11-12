import { TOTAL_SQUARES } from '$lib/constants';
import { QUARTERS } from '$lib/quarters';
import type { Quarter } from '$lib/quarters';
import { CUSTOM_PRESET_NAME, SPLIT_PRESETS, type Party, type SplitPreset } from '$lib/types';

export { CUSTOM_PRESET_NAME };

export type PayoutSplits = Record<Quarter, number>;

export interface PayoutRow {
	key: Quarter;
	label: string;
	percent: number;
	amount: number;
}

function roundCurrency(amount: number): number {
	return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function calculateTotalPot(squarePrice: number): number {
	return roundCurrency(squarePrice * TOTAL_SQUARES);
}

export function calculatePayoutAmount(totalPot: number, percent: number): number {
	return roundCurrency((totalPot * percent) / 100);
}

export function buildPayoutRows(splits: PayoutSplits, totalPot: number): PayoutRow[] {
	return QUARTERS.map(({ key, short: label }) => ({
		key,
		label,
		percent: splits[key],
		amount: calculatePayoutAmount(totalPot, splits[key]),
	}));
}

/** The percentages a party pays out. */
export function partySplits(
	p: Pick<Party, 'split_q1' | 'split_q2' | 'split_q3' | 'split_final'>
): PayoutSplits {
	return { q1: p.split_q1, q2: p.split_q2, q3: p.split_q3, final: p.split_final };
}

/** The percentages a preset stands for. */
export function presetToSplits(preset: SplitPreset): PayoutSplits {
	return { q1: preset.q1, q2: preset.q2, q3: preset.q3, final: preset.final };
}

export function splitTotal(splits: PayoutSplits): number {
	return splits.q1 + splits.q2 + splits.q3 + splits.final;
}

// Mirrors the DB CHECKs: each split an integer in 0..100, and they total 100.
export function isValidSplit(splits: PayoutSplits): boolean {
	const values = [splits.q1, splits.q2, splits.q3, splits.final];
	return (
		values.every((v) => Number.isInteger(v) && v >= 0 && v <= 100) && splitTotal(splits) === 100
	);
}

/** Name of the non-custom preset matching these percentages, else 'Custom'. */
export function findMatchingPresetName(splits: PayoutSplits): string {
	const match = SPLIT_PRESETS.find(
		(preset) =>
			preset.name !== CUSTOM_PRESET_NAME &&
			preset.q1 === splits.q1 &&
			preset.q2 === splits.q2 &&
			preset.q3 === splits.q3 &&
			preset.final === splits.final
	);
	return match?.name ?? CUSTOM_PRESET_NAME;
}
