import { describe, expect, it } from 'vitest';
import {
	buildPayoutRows,
	calculatePayoutAmount,
	calculateTotalPot,
	findMatchingPresetName,
	isValidSplit,
	presetToSplits,
	splitTotal,
} from '$lib/payouts';
import { SPLIT_PRESETS } from '$lib/types';

describe('payout domain helpers', () => {
	it('calculates a full 100-square pot from the square price', () => {
		expect(calculateTotalPot(5)).toBe(500);
		expect(calculateTotalPot(1.5)).toBe(150);
	});

	it('rounds total pots and payout amounts to currency cents', () => {
		expect(calculateTotalPot(0.99)).toBe(99);
		expect(calculatePayoutAmount(99, 12.5)).toBe(12.38);
	});

	it('builds quarter payout rows in game order', () => {
		expect(buildPayoutRows({ q1: 10, q2: 20, q3: 30, final: 40 }, 500)).toStrictEqual([
			{ key: 'q1', label: 'Q1', percent: 10, amount: 50 },
			{ key: 'q2', label: 'Q2', percent: 20, amount: 100 },
			{ key: 'q3', label: 'Q3', percent: 30, amount: 150 },
			{ key: 'final', label: 'Final', percent: 40, amount: 200 },
		]);
	});
});

describe('split helpers', () => {
	const [rising, equal] = SPLIT_PRESETS;

	it('maps a preset to its percentages', () => {
		expect(presetToSplits(rising)).toStrictEqual({
			q1: rising.q1,
			q2: rising.q2,
			q3: rising.q3,
			final: rising.final,
		});
	});

	it('totals and validates splits', () => {
		expect(splitTotal(presetToSplits(equal))).toBe(100);
		expect(isValidSplit(presetToSplits(equal))).toBe(true);
		expect(isValidSplit({ q1: 30, q2: 25, q3: 25, final: 25 })).toBe(false);
	});

	it('finds the preset matching a split, else Custom', () => {
		for (const preset of SPLIT_PRESETS.filter((p) => p.name !== 'Custom')) {
			expect(findMatchingPresetName(presetToSplits(preset))).toBe(preset.name);
		}
		expect(findMatchingPresetName({ q1: 5, q2: 5, q3: 5, final: 85 })).toBe('Custom');
		expect(findMatchingPresetName({ q1: 0, q2: 0, q3: 0, final: 0 })).toBe('Custom');
	});
});
