import { writable, derived, get } from 'svelte/store';
import type {
	Party,
	Square,
	Numbers,
	Scores,
	Winner,
	GridState,
	GameScoresRow,
	LiveScores,
} from '$lib/types';
import { TOTAL_SQUARES } from '$lib/constants';
import { userName, normalizePlayerName } from './user';
import { resolveHomeIsRow } from './game-matching';

// Unique client ID per browser tab (for broadcast deduplication)
export const clientId =
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);

// Core state stores
export const party = writable<Party | null>(null);
export const squares = writable<Square[]>([]);
export const numbers = writable<Numbers | null>(null);
export const scores = writable<Scores | null>(null);
export const winners = writable<Winner[]>([]);
export const gameScores = writable<GameScoresRow | null>(null);
export const isLoading = writable(true);
export const error = writable<string | null>(null);

// Derived stores
export const gridState = derived(
	[party, squares, numbers, scores, winners],
	([$party, $squares, $numbers, $scores, $winners]) => {
		if (!$party) return null;
		return {
			party: $party,
			squares: $squares,
			numbers: $numbers,
			scores: $scores,
			winners: $winners,
		} as GridState;
	}
);

export const liveScores = derived<[typeof gameScores, typeof party], LiveScores | null>(
	[gameScores, party],
	([$gameScores, $party]) => {
		if (!$gameScores || !$party) return null;
		const homeIsRow = resolveHomeIsRow($gameScores, $party);
		return {
			rowScore: homeIsRow ? $gameScores.home_score : $gameScores.away_score,
			colScore: homeIsRow ? $gameScores.away_score : $gameScores.home_score,
			clock: $gameScores.game_clock,
			quarter: $gameScores.game_quarter,
			status: $gameScores.game_status,
		};
	}
);

// The square currently "in the lead" based on live scores (last digit of each score → numbers lookup)
export const leadingSquare = derived(
	[liveScores, numbers, party],
	([$liveScores, $numbers, $party]) => {
		if (!$liveScores || !$numbers || !$party) return null;
		// Only show during active game
		if ($party.status !== 'active' && $party.status !== 'locked') return null;
		// Only when game is in progress (not final/pregame)
		if ($liveScores.status === 'final' || $liveScores.status === 'pregame') return null;

		const rowDigit = $liveScores.rowScore % 10;
		const colDigit = $liveScores.colScore % 10;
		const winningRow = $numbers.row_numbers.indexOf(rowDigit);
		const winningCol = $numbers.col_numbers.indexOf(colDigit);

		if (winningRow === -1 || winningCol === -1) return null;
		return { row: winningRow, col: winningCol };
	}
);

export const filledCount = derived(
	squares,
	($squares) => $squares.filter((s) => s.player_name !== null).length
);

export const isGridFull = derived(filledCount, ($count) => $count === TOTAL_SQUARES);

export const mySquares = derived([squares, userName], ([$squares, $name]) => {
	if (!$name) return [];
	const normalized = normalizePlayerName($name);
	return $squares.filter((s) => s.player_name_lower === normalized);
});

export const mySquareCount = derived(mySquares, ($mySquares) => $mySquares.length);

export const amountOwed = derived([mySquareCount, party], ([$count, $party]) => {
	if (!$party) return 0;
	return $count * $party.square_price;
});

// Player summary for legend display
export interface PlayerSummary {
	name: string;
	normalizedName: string;
	count: number;
}

export const playerSummary = derived(squares, ($squares) => {
	const playerMap = new Map<string, PlayerSummary>();

	for (const square of $squares) {
		if (square.player_name && square.player_name_lower) {
			if (!playerMap.has(square.player_name_lower)) {
				playerMap.set(square.player_name_lower, {
					name: square.player_name,
					normalizedName: square.player_name_lower,
					count: 0,
				});
			}
			const entry = playerMap.get(square.player_name_lower);
			if (entry) entry.count++;
		}
	}

	// Sort by count descending
	return Array.from(playerMap.values()).sort((a, b) => b.count - a.count);
});

export const availableCount = derived(
	squares,
	($squares) => $squares.filter((s) => s.player_name === null).length
);

// Player filter for highlighting squares by player (shared between sidebar and grid)
export const selectedPlayerFilter = writable<string | null>(null);

// Self-clearing: if the currently selected filter no longer matches any player
// in playerSummary (their last square was unclaimed, or the host removed them),
// clear it. Without this, a stale filter dims the entire grid with no pill left
// to click to undo it. This is a plain subscription — not a derived — because
// selectedPlayerFilter must never be written to from inside a derived store that
// reads it (that would create a reactive loop). playerSummary is derived only
// from `squares`, so writing selectedPlayerFilter here is safe.
playerSummary.subscribe(($playerSummary) => {
	const current = get(selectedPlayerFilter);
	if (current && !$playerSummary.some((p) => p.normalizedName === current)) {
		selectedPlayerFilter.set(null);
	}
});

/**
 * Restore a snapshotted player filter after an optimistic unclaim was rejected.
 * Only restores when the snapshot was non-null AND the filter is currently null,
 * so a filter the user deliberately set (or changed) during the in-flight window
 * is never stomped. Pairs with OptimisticOperation.filterSnapshot — see the
 * self-clearing subscription above for why the filter goes null in the first place.
 */
export function restoreSelectedPlayerFilter(snapshot: string | null | undefined): void {
	if (snapshot != null && get(selectedPlayerFilter) == null) {
		selectedPlayerFilter.set(snapshot);
	}
}

// Helper to create square key
export function squareKey(row: number, col: number): string {
	return `${row}-${col}`;
}

// ─── State-application functions (called from the realtime transport layer) ──
//
// These give the transport layer a small, typed surface to mutate state without
// reaching into store internals. Each function accepts the parsed/validated
// row from postgres_changes (or refetched data) and updates the relevant
// store. The transport layer is responsible for validating the payload first
// (Phase 1's validators) so these functions can assume well-formed input.
// applySquareUpdate also clears pending optimistic state, so it lives in
// game-pending.ts (which depends on this module, never the reverse).

/** Apply an UPDATE on the parties table. */
export function applyPartyUpdate(newParty: Party): void {
	party.set(newParty);
}

/** Apply an INSERT or UPDATE on the numbers table. */
export function applyNumbersUpdate(newNumbers: Numbers): void {
	numbers.set(newNumbers);
}

/** Apply an INSERT or UPDATE on the scores table. */
export function applyScoresUpdate(newScores: Scores): void {
	scores.set(newScores);
}

/** Apply an INSERT on the winners table. */
export function applyWinnerInsert(newWinner: Winner): void {
	winners.update((current) => [...current, newWinner]);
}

/** Apply an UPDATE on the winners table. Matches by (party_id, quarter). */
export function applyWinnerUpdate(newWinner: Winner): void {
	winners.update((current) =>
		current.map((w) =>
			w.party_id === newWinner.party_id && w.quarter === newWinner.quarter ? newWinner : w
		)
	);
}

/** Apply a DELETE on the winners table. Matches by (party_id, quarter). */
export function applyWinnerDelete(deleted: Winner): void {
	winners.update((current) =>
		current.filter((w) => !(w.party_id === deleted.party_id && w.quarter === deleted.quarter))
	);
}

/** Apply an INSERT or UPDATE on the game_scores table; null clears it. */
export function applyGameScoresUpdate(row: GameScoresRow | null): void {
	gameScores.set(row);
}
