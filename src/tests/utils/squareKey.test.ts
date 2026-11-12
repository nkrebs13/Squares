import { describe, it, expect } from 'vitest';
import { GRID_SIZE } from '$lib/constants';
import { parseSquareKey, squareKey } from '$lib/utils/squareKey';

describe('squareKey', () => {
	it('creates key from row and col', () => {
		expect(squareKey(0, 0)).toBe('0-0');
		expect(squareKey(5, 3)).toBe('5-3');
		expect(squareKey(9, 9)).toBe('9-9');
	});

	it('round-trips every cell of the grid', () => {
		for (let row = 0; row < 10; row++) {
			for (let col = 0; col < 10; col++) {
				expect(parseSquareKey(squareKey(row, col))).toEqual({ row, col });
			}
		}
	});

	it('is bound to GRID_SIZE, not to single digits', () => {
		expect(parseSquareKey(`${GRID_SIZE - 1}-0`)).toEqual({ row: GRID_SIZE - 1, col: 0 });
		expect(parseSquareKey(`0-${GRID_SIZE}`)).toBeNull();
		expect(parseSquareKey(`${GRID_SIZE}-0`)).toBeNull();
	});

	it.each(['', '3', '3-', '-3', '10-0', '0-10', 'a-b', '3-4-5', ' 3-4', '03-4', '1-00'])(
		'rejects %j',
		(key) => {
			expect(parseSquareKey(key)).toBeNull();
		}
	);
});
