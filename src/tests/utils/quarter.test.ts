import { describe, it, expect } from 'vitest';
import { formatQuarterLabel } from '$lib/utils/quarter';

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
});
