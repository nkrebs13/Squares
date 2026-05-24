import { describe, expect, it } from 'vitest';
import { buildPayoutRows, calculatePayoutAmount, calculateTotalPot } from '$lib/payouts';

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
