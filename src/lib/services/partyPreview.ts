import { getSupabaseClient } from '$lib/supabase';
import type { PartyStatus } from '$lib/types';

/** Public, read-only summary of a party shown on the join page before the player commits. */
export interface PartyPreview {
	id: string;
	eventName: string;
	kickoffAt: string | null;
	status: PartyStatus;
	teamRowName: string;
	teamColName: string;
	squarePrice: number;
	splitQ1: number;
	splitQ2: number;
	splitQ3: number;
	splitFinal: number;
	/** Claimed square count, or null when the squares query failed (shown as "Checking..."). */
	filledCount: number | null;
}

export interface PartyPreviewSuccess {
	ok: true;
	preview: PartyPreview;
}

export interface PartyPreviewFailure {
	ok: false;
	error: string;
}

export const PREVIEW_NOT_FOUND_ERROR = 'No party found for this code.';

/** What the join flow needs to decide whether the entered name is the host's. */
export interface JoinTarget {
	id: string;
	status: PartyStatus;
	hostNameLower: string | null;
}

/**
 * Look up a party by code for the join preview, plus how many squares are claimed.
 *
 * A failed squares query is not fatal: the preview is returned with `filledCount: null`.
 * `isStale` is checked between the two queries so a superseded request skips the second
 * query; in that case the returned failure is meant to be discarded by the caller.
 * Network exceptions propagate to the caller.
 */
export async function fetchPartyPreview(
	code: string,
	isStale: () => boolean = () => false
): Promise<PartyPreviewSuccess | PartyPreviewFailure> {
	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from('parties')
		.select(
			'id, event_name, kickoff_at, status, team_row_name, team_col_name, square_price, split_q1, split_q2, split_q3, split_final'
		)
		.eq('code', code)
		.single();

	if (isStale() || error || !data) return { ok: false, error: PREVIEW_NOT_FOUND_ERROR };

	const { data: squaresData } = await supabase
		.from('squares')
		.select('player_name, claimed_at')
		.eq('party_id', data.id);

	return {
		ok: true,
		preview: {
			id: data.id,
			eventName: data.event_name,
			kickoffAt: data.kickoff_at,
			status: data.status,
			teamRowName: data.team_row_name,
			teamColName: data.team_col_name,
			squarePrice: data.square_price,
			splitQ1: data.split_q1,
			splitQ2: data.split_q2,
			splitQ3: data.split_q3,
			splitFinal: data.split_final,
			filledCount: Array.isArray(squaresData)
				? squaresData.filter((square) => square.player_name || square.claimed_at).length
				: null,
		},
	};
}

/**
 * Fetch the minimal party fields the join flow needs, or null when the code matches no
 * party. Network exceptions propagate to the caller.
 */
export async function fetchJoinTarget(code: string): Promise<JoinTarget | null> {
	const supabase = getSupabaseClient();
	const { data, error } = await supabase
		.from('parties')
		.select('id, status, host_name_lower')
		.eq('code', code)
		.single();

	if (error || !data) return null;
	return { id: data.id, status: data.status, hostNameLower: data.host_name_lower };
}
