import { writable, derived } from 'svelte/store';
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
/** For a detected, unlinked game: whether its home team is the party's row team (game_side, at load). */
export const gameHomeIsRow = writable(true);
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

export const liveScores = derived<
	[typeof gameScores, typeof gameHomeIsRow, typeof party],
	LiveScores | null
>([gameScores, gameHomeIsRow, party], ([$gameScores, $detectedHomeIsRow, $party]) => {
	if (!$gameScores) return null;
	// A linked game's side lives on the party row (kept current by realtime);
	// a detected, unlinked game uses the side computed when it was loaded.
	const homeIsRow = $party?.game_id ? $party.home_team_is_row !== false : $detectedHomeIsRow;
	return {
		rowScore: homeIsRow ? $gameScores.home_score : $gameScores.away_score,
		colScore: homeIsRow ? $gameScores.away_score : $gameScores.home_score,
		clock: $gameScores.game_clock,
		quarter: $gameScores.game_quarter,
		status: $gameScores.game_status,
	};
});

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

// The player the user picked to highlight (toggled from the legend).
export const selectedPlayerFilter = writable<string | null>(null);

/**
 * The filter in effect: the picked player while they hold at least one square.
 * When their last square goes (unclaimed, removed) the grid stops dimming; if
 * the square comes back (a rejected unclaim), the highlight comes back with it.
 */
export const activePlayerFilter = derived(
	[selectedPlayerFilter, playerSummary],
	([$selected, $players]) =>
		$selected && $players.some((p) => p.normalizedName === $selected) ? $selected : null
);

export { squareKey } from '$lib/utils/squareKey';

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
