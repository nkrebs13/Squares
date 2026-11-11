// Initial party load: one get_party_state call (migration 039) fills every
// party store. Imports state from game-state, never the reverse.

import { getSupabaseClient } from '$lib/supabase';
import type { Square, Winner } from '$lib/types';
import {
	parseGameScores,
	parseNumbers,
	parseParty,
	parseScores,
	parseSquare,
	parseWinner,
} from '$lib/validators/realtime';
import { logError } from '$lib/utils/log';
import { theme } from './theme';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	gameHomeIsRow,
	isLoading,
	error,
} from './game-state';

type PartyState = {
	party: unknown;
	squares: unknown[];
	numbers: unknown;
	scores: unknown;
	winners: unknown[];
	game: { row: unknown; home_is_row: boolean; linked: boolean } | null;
};

function fail(message: string): false {
	error.set(message);
	isLoading.set(false);
	return false;
}

export async function loadParty(code: string): Promise<boolean> {
	isLoading.set(true);
	error.set(null);

	const { data, error: rpcError } = await getSupabaseClient().rpc('get_party_state', {
		p_code: code,
	});
	if (rpcError) {
		logError('[loadParty] get_party_state failed:', rpcError.message);
		return fail("Couldn't load that party. Check your connection and try again.");
	}

	const state = data as PartyState | null;
	const partyData = state ? parseParty(state.party) : null;
	if (!state || !partyData) return fail('Party not found');

	party.set(partyData);
	theme.setTeams({
		rowColor: partyData.team_row_color,
		colColor: partyData.team_col_color,
		rowName: partyData.team_row_name,
		colName: partyData.team_col_name,
	});
	// Invalid rows are dropped; an invalid single row becomes null.
	squares.set(state.squares.map(parseSquare).filter((r): r is Square => r !== null));
	numbers.set(state.numbers ? parseNumbers(state.numbers) : null);
	scores.set(state.scores ? parseScores(state.scores) : null);
	winners.set(state.winners.map(parseWinner).filter((r): r is Winner => r !== null));
	gameScores.set(state.game ? parseGameScores(state.game.row) : null);
	gameHomeIsRow.set(state.game?.home_is_row ?? true);

	isLoading.set(false);
	return true;
}
