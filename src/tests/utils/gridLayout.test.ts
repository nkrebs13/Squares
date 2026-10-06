import { describe, it, expect } from 'vitest';
import {
	MIN_CELL_SIZE_MOBILE,
	ZOOMED_CELL_SIZE,
	buildSquareMap,
	buildWinnerMap,
	calculateFitCellSize,
	cellKey,
	getEffectiveCellSize,
	getFitCellSize,
	getHeaderHeight,
	shouldShowZoomControl,
} from '$lib/utils/gridLayout';
import { createMockSquare, createMockWinner } from '../factories';

describe('gridLayout sizing', () => {
	it('falls back to the mobile minimum when width is unknown', () => {
		expect(calculateFitCellSize(0)).toBe(MIN_CELL_SIZE_MOBILE);
	});

	it('computes fit size from width minus label, gaps and padding', () => {
		// (400 - 48 label - 10 gaps*2 - 8 padding) / 11 columns = 324 / 11 -> 29
		expect(calculateFitCellSize(400)).toBe(29);
	});

	it('clamps fit size to the mobile minimum', () => {
		expect(calculateFitCellSize(200)).toBeLessThan(MIN_CELL_SIZE_MOBILE);
		expect(getFitCellSize(200)).toBe(MIN_CELL_SIZE_MOBILE);
	});

	it('picks the zoomed or fit size by zoom state', () => {
		expect(getEffectiveCellSize('fit', 30)).toBe(30);
		expect(getEffectiveCellSize('zoomed', 30)).toBe(ZOOMED_CELL_SIZE);
	});

	it('shows the zoom control only when fit is smaller than zoomed', () => {
		expect(shouldShowZoomControl(ZOOMED_CELL_SIZE - 1)).toBe(true);
		expect(shouldShowZoomControl(ZOOMED_CELL_SIZE)).toBe(false);
	});

	it('scales header height by 0.7 with a floor of 24', () => {
		expect(getHeaderHeight(100)).toBe(70);
		expect(getHeaderHeight(29)).toBe(24); // floor(20.3) = 20 -> clamped
		expect(getHeaderHeight(40)).toBe(28);
	});
});

describe('gridLayout maps', () => {
	it('keys cells as row-col', () => {
		expect(cellKey(3, 7)).toBe('3-7');
	});

	it('indexes squares by row-col', () => {
		const a = createMockSquare(0, 1);
		const b = createMockSquare(2, 3);
		const map = buildSquareMap([a, b]);
		expect(map.get('0-1')).toBe(a);
		expect(map.get('2-3')).toBe(b);
		expect(map.get('9-9')).toBeUndefined();
	});

	it('groups winners by grid position', () => {
		const w1 = createMockWinner({ quarter: 'q1', winning_row: 3, winning_col: 7 });
		const w2 = createMockWinner({ quarter: 'q2', winning_row: 3, winning_col: 7 });
		const w3 = createMockWinner({ quarter: 'q3', winning_row: 0, winning_col: 0 });
		const map = buildWinnerMap([w1, w2, w3], true);
		expect(map.get('3-7')).toEqual([w1, w2]);
		expect(map.get('0-0')).toEqual([w3]);
	});

	it('returns no winners until numbers are drawn', () => {
		expect(buildWinnerMap([createMockWinner()], false).size).toBe(0);
	});
});
