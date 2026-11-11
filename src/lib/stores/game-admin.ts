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
import { parseNumbers, parseParty } from '$lib/validators/realtime';
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

/** Refusal codes every `host_*` RPC returns (migration 035). */
type HostRefusal =
	| 'not_found'
	| 'invalid_pin'
	| 'locked_out'
	| 'wrong_status'
	| 'grid_incomplete'
	| 'invalid_input';

type HostResponse =
	| ({ ok: true } & Record<string, unknown>)
	| { ok: false; error: HostRefusal; field?: string };

const HOST_REFUSAL_COPY: Record<HostRefusal, string> = {
	not_found: 'This party no longer exists.',
	invalid_pin: 'Incorrect PIN. Please try again.',
	locked_out: 'Too many incorrect PINs. Try again in a few minutes.',
	wrong_status: 'This can only be changed before the grid is locked.',
	grid_incomplete: 'All squares must be claimed before the grid can be locked.',
	invalid_input: 'Some of those values are not valid.',
};

/** Per-action copy: `failed` for transport/unexpected errors, plus any refusal overrides. */
type HostCopy = { failed: string } & Partial<Record<HostRefusal, string>>;

type HostCallResult = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

function isHostResponse(data: unknown): data is HostResponse {
	return (
		typeof data === 'object' && data !== null && typeof (data as { ok?: unknown }).ok === 'boolean'
	);
}

/** Call a `host_*` RPC and turn its result into data or user-facing copy. */
async function callHost(
	rpc: string,
	args: Record<string, unknown>,
	copy: HostCopy
): Promise<HostCallResult> {
	const { data, error: rpcError } = await getSupabaseClient().rpc(rpc, args);
	if (rpcError || !isHostResponse(data)) return { ok: false, error: copy.failed };
	if (data.ok) return { ok: true, data };
	return { ok: false, error: copy[data.error] ?? HOST_REFUSAL_COPY[data.error] ?? copy.failed };
}

const PIN_RULE: RpcErrorRule = [/invalid party or PIN/i, 'Invalid PIN'];
const GRID_LOCKED = /before the grid is locked/i;

export async function lockParty(pin: string): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const result = await callHost(
		'host_lock_party',
		{ p_party_id: currentParty.id, p_pin: pin },
		{ failed: 'Failed to lock party. Please try again.', wrong_status: 'Grid is already locked' }
	);
	if (!result.ok) return { success: false, error: result.error };

	const lockedParty = parseParty(result.data.party);
	const assigned = parseNumbers(result.data.numbers);
	if (!lockedParty || !assigned) {
		return { success: false, error: 'Game started, but the page is out of date. Please refresh.' };
	}
	party.set(lockedParty);
	numbers.set(assigned);
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

export async function updatePayoutStructure(
	pin: string,
	splits: { q1: number; q2: number; q3: number; final: number }
): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const result = await callHost(
		'host_update_payouts',
		{
			p_party_id: currentParty.id,
			p_pin: pin,
			p_split_q1: splits.q1,
			p_split_q2: splits.q2,
			p_split_q3: splits.q3,
			p_split_final: splits.final,
		},
		{
			failed: 'Failed to update payout structure. Please try again.',
			wrong_status: 'Grid is already locked',
			invalid_input: 'Splits must add up to 100%',
		}
	);
	if (!result.ok) return { success: false, error: result.error };

	const updatedParty = parseParty(result.data.party);
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

export async function removePlayer(
	pin: string,
	playerNameLower: string
): Promise<RemovePlayerResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY, removedCount: 0 };

	const result = await callHost(
		'host_remove_player',
		{ p_party_id: currentParty.id, p_pin: pin, p_player_name: playerNameLower },
		{
			failed: 'Failed to remove player. Please try again.',
			wrong_status: 'Cannot remove players after grid is locked',
			invalid_input: 'Player name is required',
		}
	);
	if (!result.ok) return { success: false, removedCount: 0, error: result.error };

	// Clearing the squares recomputes playerSummary, which also clears the
	// player filter if it pointed at the removed player.
	squares.update((current) =>
		current.map((s) => (s.player_name_lower === playerNameLower ? clearSquareFields(s) : s))
	);
	return { success: true, removedCount: Number(result.data.removed) || 0 };
}

export async function deleteParty(pin: string): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const result = await callHost(
		'host_delete_party',
		{ p_party_id: currentParty.id, p_pin: pin },
		{ failed: 'Failed to delete party. Please try again.' }
	);
	return result.ok ? { success: true } : { success: false, error: result.error };
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

export async function verifyHostPin(code: string, pin: string): Promise<AdminResult> {
	const result = await callHost(
		'host_verify_pin',
		{ p_party_code: code, p_pin: pin },
		{ failed: 'Unable to verify PIN. Please try again.' }
	);
	return result.ok ? { success: true } : { success: false, error: result.error };
}
