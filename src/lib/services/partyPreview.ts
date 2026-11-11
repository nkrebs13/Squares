import { getSupabaseClient } from '$lib/supabase';
import type { Party } from '$lib/types';
import { parseParty } from '$lib/validators/realtime';

/** A party's public summary and how many squares are claimed (get_party_preview, migration 040). */
export interface PartyPreview {
	party: Party;
	filledCount: number;
}

export const PREVIEW_NOT_FOUND_ERROR = 'No party found for this code.';

/** The preview for a party code, or null when no party has it. Network failures throw. */
export async function fetchPartyPreview(code: string): Promise<PartyPreview | null> {
	const { data, error } = await getSupabaseClient().rpc('get_party_preview', { p_code: code });
	if (error) throw new Error(error.message);

	const response = data as { party: unknown; filled_count: number } | null;
	const party = response ? parseParty(response.party) : null;
	return party ? { party, filledCount: response?.filled_count ?? 0 } : null;
}
