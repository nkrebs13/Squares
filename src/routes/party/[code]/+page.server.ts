import { createClient } from '@supabase/supabase-js';
import { serverSupabaseEnv } from '$lib/server/supabaseEnv';
import type { PageServerLoad } from './$types';
import { partyToShareMetadata, type PartyShareMetadata } from '$lib/partyMeta';
import { parseParty } from '$lib/validators/realtime';
import { normalizePartyCode } from '$lib/utils/partyCode';

export const load: PageServerLoad = async ({ params }) => {
	const partyMeta = await loadPartyShareMetadata(params.code);
	return { partyMeta };
};

async function loadPartyShareMetadata(codeParam: string): Promise<PartyShareMetadata | null> {
	const project = serverSupabaseEnv();
	const code = normalizePartyCode(codeParam);

	if (!project || !code) {
		return null;
	}

	const supabase = createClient(project.url, project.anonKey, {
		auth: {
			persistSession: false,
			autoRefreshToken: false,
		},
	});

	const { data, error } = await supabase.rpc('get_party_preview', { p_code: code });
	const party = error || !data ? null : parseParty((data as { party: unknown }).party);
	return party ? partyToShareMetadata(party) : null;
}
