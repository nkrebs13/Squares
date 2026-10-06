import { SPLIT_PRESETS, type Quarter, type SplitPreset } from '$lib/types';

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

/** Name of the preset whose percentages are entered by hand. */
export const CUSTOM_PRESET_NAME = 'Custom';

/** The percentages a preset stands for. */
export function presetToSplits(preset: SplitPreset): PayoutSplits {
	return { q1: preset.q1, q2: preset.q2, q3: preset.q3, final: preset.final };
}

export function splitTotal(splits: PayoutSplits): number {
	return splits.q1 + splits.q2 + splits.q3 + splits.final;
}

export function isValidSplit(splits: PayoutSplits): boolean {
	return splitTotal(splits) === 100;
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
