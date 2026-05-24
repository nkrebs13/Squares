import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import type { PageServerLoad } from './$types';
import type { PartyShareMetadata } from '$lib/partyMeta';
import { normalizePartyCode } from '$lib/utils/partyCode';

interface PartyMetadataRow {
	code: string;
	event_name: string;
	kickoff_at: string | null;
	status: PartyShareMetadata['status'];
	team_row_name: string;
	team_col_name: string;
}

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

	const { data, error } = await supabase
		.from('parties')
		.select('code,event_name,kickoff_at,status,team_row_name,team_col_name')
		.eq('code', code)
		.maybeSingle<PartyMetadataRow>();

	if (error || !data) {
		return null;
	}

	return {
		code: data.code,
		eventName: data.event_name,
		kickoffAt: data.kickoff_at,
		status: data.status,
		teamRowName: data.team_row_name,
		teamColName: data.team_col_name,
	};
}
