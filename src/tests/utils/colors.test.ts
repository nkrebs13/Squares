import { describe, it, expect } from 'vitest';
import { PLAYER_COLORS, getPlayerColor } from '$lib/utils/colors';

describe('PLAYER_COLORS', () => {
	it('has exactly 15 entries', () => {
		expect(PLAYER_COLORS).toHaveLength(15);
	});

	it('each entry has bg and text rgba values', () => {
		for (const color of PLAYER_COLORS) {
			expect(color.bg).toMatch(/^rgba\(/);
			expect(color.text).toMatch(/^rgba\(/);
		}
	});
});

describe('getPlayerColor', () => {
	it('returns the same color for the same name (deterministic)', () => {
		const first = getPlayerColor('Alice');
		const second = getPlayerColor('Alice');
		expect(first).toEqual(second);
	});

	it('returns a color from the palette', () => {
		const color = getPlayerColor('Bob');
		expect(PLAYER_COLORS).toContainEqual(color);
	});

	it('handles empty string', () => {
		const color = getPlayerColor('');
		expect(PLAYER_COLORS).toContainEqual(color);
	});

	it('handles single character', () => {
		const color = getPlayerColor('X');
		expect(PLAYER_COLORS).toContainEqual(color);
	});

	it('produces more than one distinct color across multiple names', () => {
		const names = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank'];
		const uniqueColors = new Set(names.map((n) => getPlayerColor(n).bg));
		expect(uniqueColors.size).toBeGreaterThan(1);
	});
});
