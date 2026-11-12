import { GRID_SIZE } from '$lib/constants';

/**
 * A square's identity as "row-col". It keys pending operations and grid maps
 * and travels in BroadcastMessage.squareKey, so changing the format is a wire
 * protocol change (see CLAUDE.md).
 */
export function squareKey(row: number, col: number): string {
	return `${row}-${col}`;
}

/** The cell a key names, or null when the key is not a valid grid cell. */
export function parseSquareKey(key: string): { row: number; col: number } | null {
	const match = /^(0|[1-9]\d*)-(0|[1-9]\d*)$/.exec(key);
	if (!match) return null;
	const row = Number(match[1]);
	const col = Number(match[2]);
	return row < GRID_SIZE && col < GRID_SIZE ? { row, col } : null;
}
