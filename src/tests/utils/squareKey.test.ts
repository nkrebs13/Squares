import { describe, it, expect } from 'vitest';
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

	it.each(['', '3', '3-', '-3', '10-0', '0-10', 'a-b', '3-4-5', ' 3-4'])('rejects %j', (key) => {
		expect(parseSquareKey(key)).toBeNull();
	});
});
