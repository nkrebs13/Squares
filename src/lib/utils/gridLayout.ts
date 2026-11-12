import { squareKey } from './squareKey';
import { GRID_SIZE } from '$lib/constants';
import { quarterIndex } from '$lib/quarters';
import type { Square, Winner } from '$lib/types';

export const MIN_CELL_SIZE_MOBILE = 28;
export const ZOOMED_CELL_SIZE = 64;
/** Gap between cells; SimpleGrid passes it to its CSS as --grid-gap. */
export const GAP_SIZE = 2;

export const MIN_HEADER_HEIGHT = 24;
export const HEADER_HEIGHT_FACTOR = 0.7;

export type ZoomState = 'fit' | 'zoomed';

/**
 * The largest cell size that fits the header column and the GRID_SIZE columns
 * (with their gaps) into `gridWidth`, the grid's own content width (measured,
 * so labels and padding set in CSS are already excluded). Never below the
 * mobile minimum.
 */
export function getFitCellSize(gridWidth: number): number {
	const columns = GRID_SIZE + 1;
	// The inverse of gridWidthAt: the largest cell whose grid fits gridWidth.
	const fit = Math.floor((gridWidth - (columns - 1) * GAP_SIZE) / columns);
	return gridWidth > 0 ? Math.max(MIN_CELL_SIZE_MOBILE, fit) : MIN_CELL_SIZE_MOBILE;
}

/** Width of the grid (header column + GRID_SIZE cells, with gaps) at a cell size. */
export function gridWidthAt(cellSize: number): number {
	return (GRID_SIZE + 1) * cellSize + GRID_SIZE * GAP_SIZE;
}

export function getEffectiveCellSize(zoomState: ZoomState, fitCellSize: number): number {
	return zoomState === 'zoomed' ? ZOOMED_CELL_SIZE : fitCellSize;
}

/** The zoom control is only useful when zooming would cause horizontal scroll. */
export function shouldShowZoomControl(fitCellSize: number): boolean {
	return fitCellSize < ZOOMED_CELL_SIZE;
}

/** Header height scales with cell size. */
export function getHeaderHeight(effectiveCellSize: number): number {
	return Math.max(Math.floor(effectiveCellSize * HEADER_HEIGHT_FACTOR), MIN_HEADER_HEIGHT);
}

export function buildSquareMap(squares: Square[]): Map<string, Square> {
	const map = new Map<string, Square>();
	for (const s of squares) {
		map.set(squareKey(s.row_num, s.col_num), s);
	}
	return map;
}

/** Winners keyed by grid position (0-9), not header numbers. Empty until numbers are drawn. */
export function buildWinnerMap(winners: Winner[], hasNumbers: boolean): Map<string, Winner[]> {
	const map = new Map<string, Winner[]>();
	if (!hasNumbers) return map;
	for (const w of winners) {
		const key = squareKey(w.winning_row, w.winning_col);
		const existing = map.get(key) || [];
		existing.push(w);
		map.set(key, existing);
	}
	// Winners arrive in server order (alphabetical: final, q1, ...) or live-insert order;
	// a square's badges and its label read in game order.
	for (const list of map.values())
		list.sort((a, b) => quarterIndex(a.quarter) - quarterIndex(b.quarter));
	return map;
}
