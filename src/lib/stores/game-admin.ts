import { get } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	pendingOperations,
	pendingTimeouts,
	isLoading,
	error,
} from './game-state';
import { cleanupChannels } from './game-realtime';

export async function lockParty(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: lockError } = await supabase.rpc('lock_party', {
		p_party_id: currentParty.id,
		p_pin: pin,
	});

	if (lockError) {
		return { success: false, error: 'Failed to lock party. Please try again.' };
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
): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: scoreError } = await supabase.rpc('update_score', {
		p_party_id: currentParty.id,
		p_pin: pin,
		p_quarter: quarter,
		p_row_score: rowScore,
		p_col_score: colScore,
	});

	if (scoreError) {
		return { success: false, error: 'Failed to update score. Please try again.' };
	}

	if (!data) {
		return { success: false, error: 'Failed to update score - check PIN' };
	}

	return { success: true };
}

export async function updatePayoutStructure(
	pin: string,
	splits: { q1: number; q2: number; q3: number; final: number }
): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };
	if (currentParty.status !== 'filling') return { success: false, error: 'Grid is already locked' };

	// Verify splits add up to 100
	const total = splits.q1 + splits.q2 + splits.q3 + splits.final;
	if (total !== 100) {
		return { success: false, error: 'Splits must add up to 100%' };
	}

	const supabase = getSupabaseClient();

	// Verify PIN via RPC (rate-limited by check_pin_lockout)
	const pinValid = await verifyHostPin(currentParty.code, pin);
	if (!pinValid) {
		return { success: false, error: 'Invalid PIN' };
	}

	const { data, error: updateError } = await supabase
		.from('parties')
		.update({
			split_q1: splits.q1,
			split_q2: splits.q2,
			split_q3: splits.q3,
			split_final: splits.final,
		})
		.eq('id', currentParty.id)
		.select('id');

	if (updateError) {
		return { success: false, error: 'Failed to update payout structure. Please try again.' };
	}

	if (!data || data.length === 0) {
		return { success: false, error: 'Invalid PIN' };
	}

	// Update local state
	party.update((p) =>
		p
			? {
					...p,
					split_q1: splits.q1,
					split_q2: splits.q2,
					split_q3: splits.q3,
					split_final: splits.final,
				}
			: null
	);

	return { success: true };
}

export async function removePlayer(
	pin: string,
	playerNameLower: string
): Promise<{ success: boolean; removedCount: number; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, removedCount: 0, error: 'No party loaded' };

	// Only allow during filling phase
	if (currentParty.status !== 'filling') {
		return { success: false, removedCount: 0, error: 'Cannot remove players after grid is locked' };
	}

	// Verify PIN server-side before modifying squares
	const supabase = getSupabaseClient();
	const pinValid = await verifyHostPin(currentParty.code, pin);
	if (!pinValid) {
		return { success: false, removedCount: 0, error: 'Invalid PIN' };
	}

	// Remove all squares owned by this player
	// Note: player_name_lower is GENERATED ALWAYS — only set player_name and claimed_at
	const { data, error: removeError } = await supabase
		.from('squares')
		.update({ player_name: null, claimed_at: null })
		.eq('party_id', currentParty.id)
		.eq('player_name_lower', playerNameLower)
		.select('id');

	if (removeError) {
		return { success: false, removedCount: 0, error: 'Failed to remove player. Please try again.' };
	}

	const removedCount = data?.length || 0;

	// Update local state
	squares.update((current) =>
		current.map((s) =>
			s.player_name_lower === playerNameLower
				? { ...s, player_name: null, player_name_lower: null, claimed_at: null }
				: s
		)
	);

	return { success: true, removedCount };
}

export async function deleteParty(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: deleteError } = await supabase.rpc('delete_party', {
		p_party_id: currentParty.id,
		p_pin: pin,
	});

	if (deleteError) {
		return { success: false, error: 'Failed to delete party. Please try again.' };
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
