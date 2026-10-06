import { get } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
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
import { pendingOperations, pendingTimeouts, clearSquareFields } from './game-pending';
import { cleanupChannels } from './game-realtime';
import { parseParty } from '$lib/validators/realtime';
import { humanizeRpcError, PARTY_FIELD_RULES, type RpcErrorRule } from '$lib/utils/rpcError';

export interface PartyDetailsInput {
	eventName: string;
	kickoffAt: string | null;
	teamRowName: string;
	teamColName: string;
	teamRowColor: string;
	teamColColor: string;
}

/**
 * Sentinel refusal: migration 033 makes PIN/lockout failure RETURN NULL
 * (not RAISE) so check_pin_lockout's attempt increment durably commits.
 * PostgREST renders a NULL `RETURNS parties` value as a row object whose
 * columns are all null (id included), NOT JSON null, so detect the refusal
 * by the absent id. Same outcome PIN_RULE yields for an older DB that still
 * RAISEs 'invalid party or PIN'.
 */
function isPinSentinelRow(data: unknown): boolean {
	if (data == null) return true;
	return (data as { id?: unknown }).id == null;
}

type AdminResult = { success: boolean; error?: string };
type RemovePlayerResult = AdminResult & { removedCount: number };

const NO_PARTY: AdminResult = { success: false, error: 'No party loaded' };

const PIN_RULE: RpcErrorRule = [/invalid party or PIN/i, 'Invalid PIN'];
const GRID_LOCKED = /before the grid is locked/i;

export async function lockParty(pin: string): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const supabase = getSupabaseClient();

	const { data, error: lockError } = await supabase.rpc('lock_party', {
		p_party_id: currentParty.id,
		p_pin: pin,
	});

	if (lockError) {
		return {
			success: false,
			error: humanizeRpcError(lockError.message, 'Failed to lock party. Please try again.'),
		};
	}

	if (!data) {
		return {
			success: false,
			error: 'Failed to lock - check PIN and ensure all squares are filled',
		};
	}

	return { success: true };
}

export async function updateScore(
	pin: string,
	quarter: 'q1' | 'q2' | 'q3' | 'final',
	rowScore: number,
	colScore: number
): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const supabase = getSupabaseClient();

	const { data, error: scoreError } = await supabase.rpc('update_score', {
		p_party_id: currentParty.id,
		p_pin: pin,
		p_quarter: quarter,
		p_row_score: rowScore,
		p_col_score: colScore,
	});

	if (scoreError) {
		return {
			success: false,
			error: humanizeRpcError(scoreError.message, 'Failed to update score. Please try again.'),
		};
	}

	if (!data) {
		// update_score (migration 014) returns FALSE on several distinct guards —
		// invalid/locked-out PIN, party not active/locked, a bad quarter or negative
		// score, or a null_winner data-integrity check unrelated to the PIN. The RPC
		// only returns a boolean, so the client can't tell which one fired; don't
		// assert a specific cause it can't know.
		return {
			success: false,
			error:
				'Failed to update score. Check the PIN — this can also happen if the party is not active or the score data is invalid.',
		};
	}

	return { success: true };
}

const PAYOUT_ERROR_RULES: readonly RpcErrorRule[] = [
	PIN_RULE,
	[GRID_LOCKED, 'Grid is already locked'],
	[/sum to exactly 100/i, 'Splits must add up to 100%'],
	[/between 0 and 100/i, 'Each split must be between 0% and 100%.'],
];

export async function updatePayoutStructure(
	pin: string,
	splits: { q1: number; q2: number; q3: number; final: number }
): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };
	if (currentParty.status !== 'filling') return { success: false, error: 'Grid is already locked' };

	// Verify splits add up to 100
	const total = splits.q1 + splits.q2 + splits.q3 + splits.final;
	if (total !== 100) {
		return { success: false, error: 'Splits must add up to 100%' };
	}

	const supabase = getSupabaseClient();

	const { data, error: updateError } = await supabase.rpc('update_payout_structure', {
		p_party_id: currentParty.id,
		p_pin: pin,
		p_split_q1: splits.q1,
		p_split_q2: splits.q2,
		p_split_q3: splits.q3,
		p_split_final: splits.final,
	});

	if (updateError) {
		return {
			success: false,
			error: humanizeRpcError(
				updateError.message,
				'Failed to update payout structure. Please try again.',
				PAYOUT_ERROR_RULES
			),
		};
	}

	if (isPinSentinelRow(data)) {
		return { success: false, error: 'Invalid PIN' };
	}

	const updatedParty = parseParty(data);
	if (!updatedParty) {
		return { success: false, error: 'Server returned unexpected payout details. Please refresh.' };
	}

	party.set(updatedParty);
	return { success: true };
}

const PARTY_DETAILS_ERROR_RULES: readonly RpcErrorRule[] = [
	PIN_RULE,
	[GRID_LOCKED, 'Party details can only be changed before the grid is locked.'],
	...PARTY_FIELD_RULES,
	[/team_.*name/i, 'Team names cannot be blank.'],
];

export async function updatePartyDetails(
	pin: string,
	details: PartyDetailsInput
): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };
	if (currentParty.status !== 'filling') {
		return { success: false, error: 'Party details can only be changed before the grid is locked' };
	}

	const supabase = getSupabaseClient();
	const { data, error: updateError } = await supabase.rpc('update_party_details', {
		p_party_id: currentParty.id,
		p_pin: pin,
		p_event_name: details.eventName,
		p_kickoff_at: details.kickoffAt,
		p_team_row_name: details.teamRowName,
		p_team_col_name: details.teamColName,
		p_team_row_color: details.teamRowColor,
		p_team_col_color: details.teamColColor,
	});

	if (updateError) {
		return {
			success: false,
			error: humanizeRpcError(
				updateError.message,
				'Failed to update party details. Please try again.',
				PARTY_DETAILS_ERROR_RULES
			),
		};
	}

	if (isPinSentinelRow(data)) {
		return { success: false, error: 'Invalid PIN' };
	}

	const updatedParty = parseParty(data);
	if (!updatedParty) {
		return { success: false, error: 'Server returned unexpected party details. Please refresh.' };
	}

	party.set(updatedParty);
	return { success: true };
}

const REMOVE_PLAYER_ERROR_RULES: readonly RpcErrorRule[] = [
	PIN_RULE,
	[GRID_LOCKED, 'Cannot remove players after grid is locked'],
	[/player name/i, 'Player name is required'],
];

export async function removePlayer(
	pin: string,
	playerNameLower: string
): Promise<RemovePlayerResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY, removedCount: 0 };

	// Only allow during filling phase
	if (currentParty.status !== 'filling') {
		return { success: false, removedCount: 0, error: 'Cannot remove players after grid is locked' };
	}

	const supabase = getSupabaseClient();
	const { data, error: removeError } = await supabase.rpc('remove_player', {
		p_party_id: currentParty.id,
		p_pin: pin,
		p_player_name_lower: playerNameLower,
	});

	if (removeError) {
		return {
			success: false,
			removedCount: 0,
			error: humanizeRpcError(
				removeError.message,
				'Failed to remove player. Please try again.',
				REMOVE_PLAYER_ERROR_RULES
			),
		};
	}

	// Sentinel refusal (see isPinSentinelRow above): a null return with no error
	// means the PIN was rejected — distinct from a legitimate count of 0 (which
	// means "matched no squares"). remove_player RETURNS INTEGER, not a parties
	// row, so it can't reuse that predicate directly.
	if (data == null) {
		return { success: false, removedCount: 0, error: 'Invalid PIN' };
	}

	const removedCount = data;

	// Update local state. This synchronous squares.update recomputes playerSummary
	// (a derived over `squares`) and, in the same tick, fires the self-clearing
	// subscription in game-state.ts — which nulls selectedPlayerFilter when the
	// removed player was the active filter (they now own zero squares). No explicit
	// filter clear is needed here; a previous "belt and braces" block that duplicated
	// it was provably unreachable and was removed.
	squares.update((current) =>
		current.map((s) => (s.player_name_lower === playerNameLower ? clearSquareFields(s) : s))
	);

	return { success: true, removedCount };
}

export async function deleteParty(pin: string): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const supabase = getSupabaseClient();

	const { data, error: deleteError } = await supabase.rpc('delete_party', {
		p_party_id: currentParty.id,
		p_pin: pin,
	});

	if (deleteError) {
		return {
			success: false,
			error: humanizeRpcError(deleteError.message, 'Failed to delete party. Please try again.'),
		};
	}

	if (!data) {
		return { success: false, error: 'Invalid PIN' };
	}

	return { success: true };
}

export function cleanup() {
	// Clear all pending timeouts
	for (const timeoutId of pendingTimeouts.values()) {
		clearTimeout(timeoutId);
	}
	pendingTimeouts.clear();

	cleanupChannels();
	party.set(null);
	squares.set([]);
	numbers.set(null);
	scores.set(null);
	winners.set([]);
	gameScores.set(null);
	pendingOperations.set(new Map());
	isLoading.set(true);
	error.set(null);
}

export async function verifyHostPin(code: string, pin: string): Promise<boolean> {
	const supabase = getSupabaseClient();

	const { data, error } = await supabase.rpc('verify_host_pin', {
		p_party_code: code,
		p_pin: pin,
	});

	if (error) {
		return false;
	}

	return data === true;
}
