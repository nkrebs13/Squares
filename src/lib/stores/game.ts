import { writable, derived, get } from 'svelte/store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '$lib/supabase';
import type { Party, Square, Numbers, Scores, Winner, GridState } from '$lib/types';
import { theme } from './theme';
import { userName, normalizePlayerName } from './user';

// Core state stores
export const party = writable<Party | null>(null);
export const squares = writable<Square[]>([]);
export const numbers = writable<Numbers | null>(null);
export const scores = writable<Scores | null>(null);
export const winners = writable<Winner[]>([]);
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
			winners: $winners
		} as GridState;
	}
);

export const filledCount = derived(squares, ($squares) =>
	$squares.filter((s) => s.player_name !== null).length
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

// Channel management
let channel: RealtimeChannel | null = null;

export async function loadParty(code: string) {
	isLoading.set(true);
	error.set(null);

	try {
		const supabase = getSupabaseClient();

		// Fetch party
		const { data: partyData, error: partyError } = await supabase
			.from('parties')
			.select('*')
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
			colName: partyData.team_col_name
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

		// Fetch winners
		const { data: winnersData } = await supabase
			.from('winners')
			.select('*')
			.eq('party_id', partyData.id)
			.order('quarter');

		winners.set(winnersData || []);

		isLoading.set(false);
		return true;
	} catch (e) {
		console.error('Error loading party:', e);
		error.set('Failed to load party');
		isLoading.set(false);
		return false;
	}
}

export function subscribeToParty(partyId: string) {
	const supabase = getSupabaseClient();

	// Unsubscribe from previous channel
	if (channel) {
		channel.unsubscribe();
	}

	channel = supabase
		.channel(`party:${partyId}`)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'squares',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'UPDATE') {
					squares.update((current) =>
						current.map((s) =>
							s.id === (payload.new as Square).id ? (payload.new as Square) : s
						)
					);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'parties',
				filter: `id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'UPDATE') {
					party.set(payload.new as Party);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'numbers',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
					numbers.set(payload.new as Numbers);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'scores',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
					scores.set(payload.new as Scores);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'winners',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				winners.update((current) => [...current, payload.new as Winner]);
			}
		)
		.subscribe();

	return () => {
		if (channel) {
			channel.unsubscribe();
			channel = null;
		}
	};
}

export async function claimSquare(row: number, col: number): Promise<boolean> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return false;
	if (currentParty.status !== 'filling') return false;

	const supabase = getSupabaseClient();

	const { error: claimError } = await supabase.rpc('claim_square', {
		p_party_id: currentParty.id,
		p_row: row,
		p_col: col,
		p_player_name: currentUser
	});

	return !claimError;
}

export async function claimSquaresBatch(cells: Array<{ row: number; col: number }>): Promise<number> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser || cells.length === 0) return 0;
	if (currentParty.status !== 'filling') return 0;

	const supabase = getSupabaseClient();

	const { data, error: claimError } = await supabase.rpc('claim_squares_batch', {
		p_party_id: currentParty.id,
		p_player_name: currentUser,
		p_cells: cells
	});

	if (claimError) {
		console.error('Batch claim error:', claimError);
		return 0;
	}

	return data || 0;
}

export async function unclaimSquare(row: number, col: number): Promise<boolean> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return false;
	if (currentParty.status !== 'filling') return false;

	const supabase = getSupabaseClient();

	const { error: unclaimError } = await supabase.rpc('unclaim_square', {
		p_party_id: currentParty.id,
		p_row: row,
		p_col: col,
		p_player_name: currentUser
	});

	return !unclaimError;
}

export async function lockParty(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: lockError } = await supabase.rpc('lock_party', {
		p_party_id: currentParty.id,
		p_pin: pin
	});

	if (lockError) {
		return { success: false, error: lockError.message };
	}

	if (!data) {
		return { success: false, error: 'Failed to lock - check PIN and ensure all squares are filled' };
	}

	return { success: true };
}

export async function startGame(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: startError } = await supabase.rpc('start_game', {
		p_party_id: currentParty.id,
		p_pin: pin
	});

	if (startError) {
		return { success: false, error: startError.message };
	}

	if (!data) {
		return { success: false, error: 'Failed to start game - check PIN' };
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
		p_col_score: colScore
	});

	if (scoreError) {
		return { success: false, error: scoreError.message };
	}

	if (!data) {
		return { success: false, error: 'Failed to update score - check PIN' };
	}

	return { success: true };
}

export function cleanup() {
	if (channel) {
		channel.unsubscribe();
		channel = null;
	}
	party.set(null);
	squares.set([]);
	numbers.set(null);
	scores.set(null);
	winners.set([]);
	isLoading.set(true);
	error.set(null);
}
