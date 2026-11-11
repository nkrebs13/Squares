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
	const match = /^(\d)-(\d)$/.exec(key);
	return match ? { row: Number(match[1]), col: Number(match[2]) } : null;
}
