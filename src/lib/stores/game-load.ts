// Initial party load: one party fetch, optional live-game auto-detect, then the
// party's child rows in parallel. Imports state from game-state (never the
// reverse) and team matching from game-matching.
//
// The private helpers below are deliberately NOT async: each returns the
// Supabase builder/promise it creates, so loadParty awaits exactly what it
// awaited before the split, with the same microtask timing and the same
// from() call order (tests queue from() mocks by call order).

import { getSupabaseClient } from '$lib/supabase';
import type { Party, GameScoresRow, Square, Winner } from '$lib/types';
import {
	parseGameScores,
	parseNumbers,
	parseParty,
	parseScores,
	parseSquare,
	parseWinner,
} from '$lib/validators/realtime';
import { logError, logWarn } from '$lib/utils/log';
import { theme } from './theme';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	isLoading,
	error,
} from './game-state';
import { gameScoresMatchParty } from './game-matching';

type Supabase = ReturnType<typeof getSupabaseClient>;

// Every party column except host_pin — it should never reach the client.
const PARTY_COLUMNS =
	'id, code, host_name_lower, event_name, kickoff_at, square_price, split_q1, split_q2, split_q3, split_final, status, team_row_name, team_col_name, team_row_color, team_col_color, created_at, updated_at, expires_at, game_id, home_team_is_row';

const EMPTY_RESULT = { data: null, error: null };

function fetchParty(supabase: Supabase, code: string) {
	return supabase.from('parties').select(PARTY_COLUMNS).eq('code', code.toUpperCase()).single();
}

function fetchActiveGames(supabase: Supabase) {
	return supabase.from('game_scores').select('*').neq('game_status', 'final').limit(10);
}

/**
 * Pick the non-final game_scores row whose matchup matches this party. Only a
 * matching row links; otherwise an arbitrary game_scores row could show the
 * wrong live context. A query error is logged and treated as "no live game".
 */
function detectLiveGame(
	activeGames: { data: unknown[] | null; error: { message: string } | null },
	partyData: Party
): GameScoresRow | null {
	if (activeGames.error) {
		logWarn('[loadParty] active game auto-detect failed:', activeGames.error.message);
		return null;
	}
	return (
		activeGames.data
			?.map((candidate) => parseGameScores(candidate))
			.find(
				(candidate): candidate is GameScoresRow =>
					candidate !== null && gameScoresMatchParty(candidate, partyData)
			) ?? null
	);
}

/** Fetch all remaining party data in parallel — independent after the party + game lookup. */
function fetchPartyChildren(
	supabase: Supabase,
	partyData: Party,
	effectiveGameId: string | null,
	detectedGameScores: GameScoresRow | null
) {
	return Promise.all([
		supabase
			.from('squares')
			.select('*')
			.eq('party_id', partyData.id)
			.order('row_num')
			.order('col_num'),
		partyData.status !== 'filling'
			? supabase.from('numbers').select('*').eq('party_id', partyData.id).single()
			: Promise.resolve(EMPTY_RESULT),
		supabase.from('scores').select('*').eq('party_id', partyData.id).single(),
		detectedGameScores
			? Promise.resolve({ data: detectedGameScores, error: null })
			: effectiveGameId
				? supabase.from('game_scores').select('*').eq('game_id', effectiveGameId).single()
				: Promise.resolve(EMPTY_RESULT),
		supabase.from('winners').select('*').eq('party_id', partyData.id).order('quarter'),
	]);
}

/**
 * Fire-and-forget: auto-correct home_team_is_row server-side from the linked
 * game row. Backend triggers use this flag for winner calculation, so direct
 * anon writes are intentionally disallowed.
 */
function syncHomeMapping(supabase: Supabase, partyId: string): void {
	supabase
		.rpc('sync_party_home_team_mapping', { p_party_id: partyId })
		.then(({ data, error: mappingError }) => {
			if (mappingError) {
				logWarn('[loadParty] failed to sync home_team_is_row:', mappingError.message);
				return;
			}

			const updatedParty = parseParty(data);
			if (updatedParty) {
				party.set(updatedParty);
			}
		});
}

export async function loadParty(code: string) {
	isLoading.set(true);
	error.set(null);

	try {
		const supabase = getSupabaseClient();

		const { data: rawPartyData, error: partyError } = await fetchParty(supabase, code);
		// An invalid party row is treated like a missing one.
		const partyData = partyError ? null : parseParty(rawPartyData);

		if (!partyData) {
			error.set('Party not found');
			isLoading.set(false);
			return false;
		}

		// Auto-detect live game when party isn't linked to one.
		let effectiveGameId = partyData.game_id;
		let detectedGameScores: GameScoresRow | null = null;
		if (!effectiveGameId) {
			detectedGameScores = detectLiveGame(await fetchActiveGames(supabase), partyData);
			if (detectedGameScores) {
				effectiveGameId = detectedGameScores.game_id;
			}
		}

		party.set(
			effectiveGameId !== partyData.game_id ? { ...partyData, game_id: effectiveGameId } : partyData
		);

		// Update theme with party colors
		theme.setTeams({
			rowColor: partyData.team_row_color,
			colColor: partyData.team_col_color,
			rowName: partyData.team_row_name,
			colName: partyData.team_col_name,
		});

		const [squaresRes, numbersRes, scoresRes, gameScoresRes, winnersRes] = await fetchPartyChildren(
			supabase,
			partyData,
			effectiveGameId,
			detectedGameScores
		);

		// Validate each fetched row; invalid rows are dropped (single-row results become null).
		squares.set((squaresRes.data ?? []).map(parseSquare).filter((r): r is Square => r !== null));
		numbers.set(numbersRes.data ? parseNumbers(numbersRes.data) : null);
		scores.set(scoresRes.data ? parseScores(scoresRes.data) : null);
		winners.set((winnersRes.data ?? []).map(parseWinner).filter((r): r is Winner => r !== null));

		// Handle game scores + home_team_is_row auto-correction
		if (effectiveGameId) {
			const { data: gameScoresData, error: gameScoresError } = gameScoresRes;
			// PGRST116 = "no rows returned" - expected when game hasn't started yet.
			// Other errors are logged so they're visible during dev/observability.
			// We still proceed because live scores are optional; realtime will pick up
			// data when the game starts.
			if (gameScoresError && gameScoresError.code !== 'PGRST116') {
				logWarn(
					`[loadParty] live game_scores fetch failed for game ${effectiveGameId}:`,
					gameScoresError.message
				);
			}
			gameScores.set(gameScoresData || null);

			if (gameScoresData) {
				syncHomeMapping(supabase, partyData.id);
			}
		} else {
			gameScores.set(null);
		}

		isLoading.set(false);
		return true;
	} catch (e) {
		// Preserve underlying message for diagnostics (logged + sent to Sentry);
		// user-facing copy stays approachable.
		const detail = e instanceof Error ? e.message : String(e);
		logError('[loadParty] fatal error loading party:', detail);
		error.set("Couldn't load that party. Check your connection and try again.");
		isLoading.set(false);
		return false;
	}
}
