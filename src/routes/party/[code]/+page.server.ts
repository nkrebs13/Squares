import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import { partyToShareMetadata, type PartyShareMetadata } from '$lib/partyMeta';
import { parseParty } from '$lib/validators/realtime';
import { normalizePartyCode } from '$lib/utils/partyCode';

export const load: PageServerLoad = async ({ params }) => {
	const partyMeta = await loadPartyShareMetadata(params.code);
	return { partyMeta };
};

async function loadPartyShareMetadata(codeParam: string): Promise<PartyShareMetadata | null> {
	const supabaseUrl = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
	const supabaseAnonKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
	const code = normalizePartyCode(codeParam);

	if (!supabaseUrl || !supabaseAnonKey || !code) {
		return null;
	}

	const supabase = createClient(supabaseUrl, supabaseAnonKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	const { data, error } = await supabase.rpc('get_party_preview', { p_code: code });
	const party = error || !data ? null : parseParty((data as { party: unknown }).party);
	return party ? partyToShareMetadata(party) : null;
}
