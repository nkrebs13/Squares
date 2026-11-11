import { describe, it, expect } from 'vitest';
import { parseSquareKey, squareKey } from '$lib/utils/squareKey';

describe('squareKey', () => {
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
