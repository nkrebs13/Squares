import { getSupabaseClient } from '$lib/supabase';
import { parseParty } from '$lib/validators/realtime';
import { APP_CONFIG, DEFAULT_TEAMS } from '$lib/config';
import { type Party } from '$lib/types';

/**
 * Input for creating a new party.
 *
 * The `teams` field is optional — when omitted, the server uses the schema
 * defaults (Seahawks vs Patriots) which match `DEFAULT_TEAMS`. The client
 * passes it explicitly here so the wire-level value is unambiguous.
 */
export interface CreatePartyInput {
	eventName?: string;
	kickoffAt?: string | null;
	hostName: string;
	hostPin: string;
	squarePrice: number;
	splits: { q1: number; q2: number; q3: number; final: number };
	teams?: {
		row: { name: string; color: string };
		col: { name: string; color: string };
	};
}

export interface CreatePartyResult {
	ok: true;
	party: Party;
}

export interface CreatePartyError {
	ok: false;
	error: string;
}

/**
 * Create a new party via the `create_party` RPC (migration 023).
 *
 * The RPC validates inputs, generates a unique 6-char party code with retry,
 * inserts the party row, the 100 squares, and the empty scores row — all in
 * a single transaction. On any failure no rows are left behind.
 *
 * On success returns `{ ok: true, party }`. On failure returns
 * `{ ok: false, error }` with a user-facing message.
 */
export async function createParty(
	input: CreatePartyInput
): Promise<CreatePartyResult | CreatePartyError> {
	const supabase = getSupabaseClient();
	const teams = input.teams ?? DEFAULT_TEAMS;

	const { data, error } = await supabase.rpc('create_party', {
		p_host_name: input.hostName,
		p_pin: input.hostPin,
		p_square_price: input.squarePrice,
		p_split_q1: input.splits.q1,
		p_split_q2: input.splits.q2,
		p_split_q3: input.splits.q3,
		p_split_final: input.splits.final,
		p_team_row_name: teams.row.name,
		p_team_col_name: teams.col.name,
		p_team_row_color: teams.row.color,
		p_team_col_color: teams.col.color,
		p_event_name: input.eventName?.trim() || APP_CONFIG.defaultEventName,
		p_kickoff_at: input.kickoffAt || null,
	});

	if (error) {
		return { ok: false, error: humanizeRpcError(error.message) };
	}

	const party = parseParty(data);
	if (!party) {
		return {
			ok: false,
			error: 'Created party but the server returned an unexpected shape — please retry.',
		};
	}

	return { ok: true, party };
}

/**
 * Translate raw Postgres error messages into user-facing copy. The RPC raises
 * `RAISE EXCEPTION` with explanatory text already; this layer trims the
 * `ERROR:  ` prefix and applies a small amount of polishing.
 */
function humanizeRpcError(raw: string): string {
	const normalized = raw.replace(/^ERROR:\s*/i, '').trim();
	if (/4 digits/i.test(normalized)) return 'PIN must be exactly 4 digits.';
	if (/sum to exactly 100/i.test(normalized)) return 'Prize splits must total 100%.';
	if (/host_name/i.test(normalized)) return 'Please enter a host name.';
	if (/event_name/i.test(normalized)) return 'Event name must be 80 characters or fewer.';
	if (/different teams/i.test(normalized)) return 'Choose two different teams for the matchup.';
	if (/colors/i.test(normalized)) return 'Team colors must be valid hex colors.';
	if (/square_price/i.test(normalized)) return 'Square price must be greater than 0.';
	if (/unique party code/i.test(normalized)) {
		return 'Could not generate a unique party code — please try again.';
	}
	return normalized || 'Failed to create party. Please try again.';
}
