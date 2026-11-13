import type { PayoutSplits } from '$lib/payouts';
import { get } from 'svelte/store';
import { party, squares, numbers, scores, winners } from './game-state';
import { clearSquareFields } from './game-pending';
import { broadcastScoreUpdate } from './game-realtime';
import { parseNumbers, parseParty, parseScores, parseWinnerArray } from '$lib/validators/realtime';
import type { Quarter } from '$lib/types';
import { callHost } from '$lib/services/hostAction';
import { eventNameOrDefault } from '$lib/config';

export interface PartyDetailsInput {
	eventName: string;
	kickoffAt: string | null;
	teamRowName: string;
	teamColName: string;
	teamRowColor: string;
	teamColColor: string;
}

type AdminResult = { success: boolean; error?: string };
type RemovePlayerResult = AdminResult & { removedCount: number };

const NO_PARTY: AdminResult = { success: false, error: 'No party loaded' };

/**
 * Whether the party an action started on is still the one shown. The host may leave
 * (or open another party) while the call is in flight; its result then belongs to no
 * page and must not land in the next party's stores. The server change stands.
 */
const stillShowing = (partyId: string) => get(party)?.id === partyId;

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
	if (!stillShowing(currentParty.id)) return { success: true };
	party.set(lockedParty);
	numbers.set(assigned);
	return { success: true };
}

export async function updateScore(
	pin: string,
	quarter: Quarter,
	rowScore: number,
	colScore: number
): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const result = await callHost(
		'host_record_score',
		{
			p_party_id: currentParty.id,
			p_pin: pin,
			p_quarter: quarter,
			p_row_score: rowScore,
			p_col_score: colScore,
		},
		{
			failed: 'Failed to update score. Please try again.',
			wrong_status: 'Scores can only be entered while the game is running.',
		}
	);
	if (!result.ok) return { success: false, error: result.error };

	const updatedParty = parseParty(result.data.party);
	const updatedScores = parseScores(result.data.scores);
	const updatedWinners = parseWinnerArray(result.data.winners);
	if (!updatedParty || !updatedScores || !updatedWinners) {
		return { success: false, error: 'Score saved, but the page is out of date. Please refresh.' };
	}
	if (!stillShowing(currentParty.id)) return { success: true };
	party.set(updatedParty);
	scores.set(updatedScores);
	winners.set(updatedWinners);
	broadcastScoreUpdate();
	return { success: true };
}

export async function updatePayoutStructure(
	pin: string,
	splits: PayoutSplits
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
		}
	);
	if (!result.ok) return { success: false, error: result.error };

	const updatedParty = parseParty(result.data.party);
	if (!updatedParty) {
		return { success: false, error: 'Server returned unexpected payout details. Please refresh.' };
	}
	if (stillShowing(currentParty.id)) party.set(updatedParty);
	return { success: true };
}

export async function updatePartyDetails(
	pin: string,
	details: PartyDetailsInput
): Promise<AdminResult> {
	const currentParty = get(party);
	if (!currentParty) return { ...NO_PARTY };

	const result = await callHost(
		'host_update_details',
		{
			p_party_id: currentParty.id,
			p_pin: pin,
			p_event_name: eventNameOrDefault(details.eventName),
			p_kickoff_at: details.kickoffAt,
			p_team_row_name: details.teamRowName,
			p_team_col_name: details.teamColName,
			p_team_row_color: details.teamRowColor,
			p_team_col_color: details.teamColColor,
		},
		{
			failed: 'Failed to update party details. Please try again.',
			wrong_status: 'Party details can only be changed before the grid is locked.',
		}
	);
	if (!result.ok) return { success: false, error: result.error };

	const updatedParty = parseParty(result.data.party);
	if (!updatedParty) {
		return { success: false, error: 'Server returned unexpected party details. Please refresh.' };
	}
	if (stillShowing(currentParty.id)) party.set(updatedParty);
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
		}
	);
	if (!result.ok) return { success: false, removedCount: 0, error: result.error };

	const removedCount = Number(result.data.removed) || 0;
	if (!stillShowing(currentParty.id)) return { success: true, removedCount };
	// Clearing the squares recomputes playerSummary, which also clears the
	// player filter if it pointed at the removed player.
	squares.update((current) =>
		current.map((s) => (s.player_name_lower === playerNameLower ? clearSquareFields(s) : s))
	);
	return { success: true, removedCount };
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

export async function verifyHostPin(code: string, pin: string): Promise<AdminResult> {
	const result = await callHost(
		'host_verify_pin',
		{ p_party_code: code, p_pin: pin },
		{ failed: 'Unable to verify PIN. Please try again.' }
	);
	return result.ok ? { success: true } : { success: false, error: result.error };
}
