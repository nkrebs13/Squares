import { writable, derived } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
import type {
	Party,
	Square,
	Numbers,
	Scores,
	Winner,
	GridState,
	OptimisticOperation,
	GameScoresRow,
	LiveScores,
} from '$lib/types';
import { theme } from './theme';
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
		const homeIsRow = $party.home_team_is_row ?? true;
		return {
			rowScore: homeIsRow ? $gameScores.home_score : $gameScores.away_score,
			colScore: homeIsRow ? $gameScores.away_score : $gameScores.home_score,
			clock: $gameScores.game_clock,
			quarter: $gameScores.game_quarter,
			status: $gameScores.game_status,
		};
	}
);

export const filledCount = derived(
	squares,
	($squares) => $squares.filter((s) => s.player_name !== null).length
);

export const isGridFull = derived(filledCount, ($count) => $count === 100);

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

// Track pending optimistic operations
export const pendingOperations = writable<Map<string, OptimisticOperation>>(new Map());

// Track timeout IDs for cleanup
export const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Timeout for pending operations (10 seconds)
export const PENDING_TIMEOUT_MS = 10000;

// Helper to create square key
export function squareKey(row: number, col: number): string {
	return `${row}-${col}`;
}

export async function loadParty(code: string) {
	isLoading.set(true);
	error.set(null);

	try {
		const supabase = getSupabaseClient();

		// Fetch party (exclude host_pin — it should never reach the client)
		const { data: partyData, error: partyError } = await supabase
			.from('parties')
			.select(
				'id, code, host_name_lower, square_price, split_q1, split_q2, split_q3, split_final, status, team_row_name, team_col_name, team_row_color, team_col_color, created_at, updated_at, expires_at, game_id, home_team_is_row'
			)
			.eq('code', code.toUpperCase())
			.single();

		if (partyError || !partyData) {
			error.set('Party not found');
			isLoading.set(false);
			return false;
		}

		party.set(partyData);

		// Update theme with party colors
		theme.setTeams({
			rowColor: partyData.team_row_color,
			colColor: partyData.team_col_color,
			rowName: partyData.team_row_name,
			colName: partyData.team_col_name,
		});

		// Fetch squares
		const { data: squaresData } = await supabase
			.from('squares')
			.select('*')
			.eq('party_id', partyData.id)
			.order('row_num')
			.order('col_num');

		squares.set(squaresData || []);

		// Fetch numbers if locked
		if (partyData.status !== 'filling') {
			const { data: numbersData } = await supabase
				.from('numbers')
				.select('*')
				.eq('party_id', partyData.id)
				.single();

			numbers.set(numbersData || null);
		}

		// Fetch scores
		const { data: scoresData } = await supabase
			.from('scores')
			.select('*')
			.eq('party_id', partyData.id)
			.single();

		scores.set(scoresData || null);

		// Fetch live game scores if party is linked to a game
		if (partyData.game_id) {
			const { data: gameScoresData, error: gameScoresError } = await supabase
				.from('game_scores')
				.select('*')
				.eq('game_id', partyData.game_id)
				.single();

			// PGRST116 = "no rows returned" - expected when game hasn't started yet
			// Other errors are logged but don't fail the page load (live scores are optional)
			if (gameScoresError && gameScoresError.code !== 'PGRST116') {
				// Non-critical error - realtime will pick up data when available
			}
			gameScores.set(gameScoresData || null);
		} else {
			gameScores.set(null);
		}

		// Fetch winners
		const { data: winnersData } = await supabase
			.from('winners')
			.select('*')
			.eq('party_id', partyData.id)
			.order('quarter');

		winners.set(winnersData || []);

		isLoading.set(false);
		return true;
	} catch {
		error.set('Failed to load party');
		isLoading.set(false);
		return false;
	}
}
