import { get } from 'svelte/store';
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
import { isStaleImage } from '$lib/partyStatus';
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
	PARTY_NOT_FOUND,
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

/** Call get_party_state. Null when the call went stale (page left); `failed` carries the error. */
async function fetchPartyState(
	code: string,
	isCurrent: () => boolean,
	label: string
): Promise<{ state: PartyState | null } | { failed: Error } | null> {
	try {
		const response = await getSupabaseClient().rpc('get_party_state', { p_code: code });
		// The page may have been left (or another party opened) while this was in flight.
		if (!isCurrent()) return null;
		if (response.error) throw new Error(response.error.message);
		return { state: response.data as PartyState | null };
	} catch (e) {
		if (!isCurrent()) return null;
		const err = e instanceof Error ? e : new Error(String(e));
		logError(`[${label}] get_party_state failed:`, err.message);
		return { failed: err };
	}
}

/** Write a fetched party state into every party store. False when it holds no valid party. */
function applyPartyState(state: PartyState | null): boolean {
	const partyData = state ? parseParty(state.party) : null;
	if (!state || !partyData) return false;

	party.set(partyData);
	// Invalid rows are dropped; an invalid single row becomes null.
	squares.set(state.squares.map(parseSquare).filter((r): r is Square => r !== null));
	numbers.set(state.numbers ? parseNumbers(state.numbers) : null);
	scores.set(state.scores ? parseScores(state.scores) : null);
	winners.set(state.winners.map(parseWinner).filter((r): r is Winner => r !== null));
	gameScores.set(state.game ? parseGameScores(state.game.row) : null);
	gameHomeIsRow.set(state.game?.home_is_row ?? true);
	return true;
}

export async function loadParty(code: string, isCurrent: () => boolean): Promise<boolean> {
	isLoading.set(true);
	error.set(null);

	const result = await fetchPartyState(code, isCurrent, 'loadParty');
	// Re-check after the await: the caller may have moved on since the fetch returned.
	if (!result || !isCurrent()) return false;
	if ('failed' in result)
		return fail("Couldn't load that party. Check your connection and try again.");
	if (!applyPartyState(result.state)) return fail(PARTY_NOT_FOUND);

	isLoading.set(false);
	return true;
}

/**
 * Re-read a party we are already showing (after a realtime reconnect) and apply it.
 * Quiet: never touches isLoading or error, and a failure keeps the current state.
 * True when fresh state was applied.
 */
export async function refreshParty(code: string, isCurrent: () => boolean): Promise<boolean> {
	const result = await fetchPartyState(code, isCurrent, 'refreshParty');
	if (!result || !isCurrent() || 'failed' in result) return false;
	// No party at all: it was deleted while open.
	if (result.state === null) {
		error.set(PARTY_NOT_FOUND);
		return false;
	}
	// A snapshot read before a status change that has since been applied is out of date
	// as a whole (numbers, scores, winners too); keep what we have.
	const next = result.state ? parseParty(result.state.party) : null;
	if (next && isStaleImage(next, get(party))) return false;
	return applyPartyState(result.state);
}
