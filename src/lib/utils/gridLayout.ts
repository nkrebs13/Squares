import { GRID_SIZE } from '$lib/constants';
import type { Square, Winner } from '$lib/types';

// Grid constants
export const MIN_CELL_SIZE_MOBILE = 28;
export const ZOOMED_CELL_SIZE = 64;
export const GAP_SIZE = 2;
export const TEAM_LABEL_WIDTH = 48;
export const SCROLL_CONTAINER_PADDING = 8;

export const MIN_HEADER_HEIGHT = 24;
export const HEADER_HEIGHT_FACTOR = 0.7;

export type ZoomState = 'fit' | 'zoomed';

/** Fit-to-width cell size (unclamped) for the given container width. */
export function calculateFitCellSize(containerWidth: number): number {
	if (!containerWidth) return MIN_CELL_SIZE_MOBILE;
	const totalColumns = GRID_SIZE + 1; // 10 data + 1 row header
	const totalGaps = totalColumns - 1;
	const gapTotal = totalGaps * GAP_SIZE;
	const availableWidth = containerWidth - TEAM_LABEL_WIDTH - gapTotal - SCROLL_CONTAINER_PADDING;
	return Math.floor(availableWidth / totalColumns);
}

/** Fit-to-width cell size, never below the mobile minimum. */
export function getFitCellSize(containerWidth: number): number {
	return Math.max(MIN_CELL_SIZE_MOBILE, calculateFitCellSize(containerWidth));
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

export function cellKey(row: number, col: number): string {
	return `${row}-${col}`;
}

export function buildSquareMap(squares: Square[]): Map<string, Square> {
	const map = new Map<string, Square>();
	for (const s of squares) {
		map.set(cellKey(s.row_num, s.col_num), s);
	}
	return map;
}

/** Winners keyed by grid position (0-9), not header numbers. Empty until numbers are drawn. */
export function buildWinnerMap(winners: Winner[], hasNumbers: boolean): Map<string, Winner[]> {
	const map = new Map<string, Winner[]>();
	if (!hasNumbers) return map;
	for (const w of winners) {
		const key = cellKey(w.winning_row, w.winning_col);
		const existing = map.get(key) || [];
		existing.push(w);
		map.set(key, existing);
	}
	return map;
}
