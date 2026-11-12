import { isGameInProgress } from '$lib/partyStatus';
import { isGameLive } from '$lib/liveGame';
import { writable, derived } from 'svelte/store';
import type { Party, Square, Numbers, Scores, Winner, GameScoresRow, LiveScores } from '$lib/types';
import { TOTAL_SQUARES } from '$lib/constants';
import { DEFAULT_TEAMS } from '$lib/config';
import { userName } from './user';
import { normalizePlayerName } from '$lib/utils/playerName';

// Unique client ID per browser tab (for broadcast deduplication)
export const clientId =
	typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
		? crypto.randomUUID()
		: Math.random().toString(36).slice(2);

// Per-party state. Every store made with `resettable` goes back to its
// starting value in resetPartyState(), so a new store is reset when leaving a
// party without anyone remembering to add it to cleanup().
const resets: Array<() => void> = [];
function resettable<T>(initial: T) {
	const store = writable<T>(initial);
	resets.push(() => store.set(initial));
	return store;
}

export function resetPartyState(): void {
	for (const reset of resets) reset();
}

export const party = resettable<Party | null>(null);
export const squares = resettable<Square[]>([]);
export const numbers = resettable<Numbers | null>(null);
export const scores = resettable<Scores | null>(null);
export const winners = resettable<Winner[]>([]);
export const gameScores = resettable<GameScoresRow | null>(null);
/** For a detected, unlinked game: whether its home team is the party's row team (game_side, at load). */
export const gameHomeIsRow = resettable(true);
export const isLoading = resettable(true);
export const error = resettable<string | null>(null);

/** Shown when the party does not exist, or stops existing while open. */
export const PARTY_NOT_FOUND = 'Party not found';

export const liveScores = derived<
	[typeof gameScores, typeof gameHomeIsRow, typeof party],
	LiveScores | null
>([gameScores, gameHomeIsRow, party], ([$gameScores, $detectedHomeIsRow, $party]) => {
	if (!$gameScores) return null;
	// A linked game's side lives on the party row (kept current by realtime);
	// a detected, unlinked game uses the side computed when it was loaded.
	const homeIsRow = $party?.game_id ? $party.home_team_is_row : $detectedHomeIsRow;
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
		if (!isGameInProgress($party.status)) return null;
		if (!isGameLive($liveScores.status)) return null;

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

	return Array.from(playerMap.values()).sort((a, b) => b.count - a.count);
});

export const availableCount = derived(
	squares,
	($squares) => $squares.filter((s) => s.player_name === null).length
);

// The player the user picked to highlight (toggled from the legend).
export const selectedPlayerFilter = resettable<string | null>(null);

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

// ─── State-application functions (called from the realtime transport layer) ──
//
// A small, typed surface for the transport layer to mutate state without
// reaching into store internals. Callers validate the payload first
// (validators/realtime.ts), so these assume well-formed rows.
// applySquareUpdate also clears pending optimistic state, so it lives in
// game-pending.ts (which depends on this module, never the reverse).

/**
 * Apply an INSERT or UPDATE on the winners table. A party has one winner per quarter
 * (UNIQUE (party_id, quarter)), and the same winner can arrive twice: once as the row
 * change and once in the winners refetch that follows a score_update broadcast. So it
 * replaces whatever that quarter held (in place), never appends a second copy.
 */
export function applyWinner(newWinner: Winner): void {
	winners.update((current) => {
		const same = (w: Winner) =>
			w.party_id === newWinner.party_id && w.quarter === newWinner.quarter;
		return current.some(same)
			? current.map((w) => (same(w) ? newWinner : w))
			: [...current, newWinner];
	});
}

/** The party's teams and colours, with the configured defaults before a party loads. */
export const teamTheme = derived(party, ($party) => ({
	rowName: $party?.team_row_name ?? DEFAULT_TEAMS.row.name,
	colName: $party?.team_col_name ?? DEFAULT_TEAMS.col.name,
	rowColor: $party?.team_row_color ?? DEFAULT_TEAMS.row.color,
	colColor: $party?.team_col_color ?? DEFAULT_TEAMS.col.color,
}));
