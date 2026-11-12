import type { PayoutSplits } from '$lib/payouts';
import { parseParty } from '$lib/validators/realtime';
import { type Party } from '$lib/types';
import { callHost } from '$lib/services/hostAction';
import { eventNameOrDefault } from '$lib/config';

export interface CreatePartyInput {
	eventName?: string;
	kickoffAt?: string | null;
	hostName: string;
	hostPin: string;
	squarePrice: number;
	splits: PayoutSplits;
	teams: {
		row: { name: string; color: string };
		col: { name: string; color: string };
	};
}

export type CreatePartyResult = { ok: true; party: Party } | { ok: false; error: string };

/**
 * Create a party with its grid of squares and scores row in one transaction
 * (`host_create_party`, migration 036). Invalid input comes back as copy for
 * the offending field.
 */
export async function createParty(input: CreatePartyInput): Promise<CreatePartyResult> {
	const result = await callHost(
		'host_create_party',
		{
			p_host_name: input.hostName,
			p_pin: input.hostPin,
			p_square_price: input.squarePrice,
			p_split_q1: input.splits.q1,
			p_split_q2: input.splits.q2,
			p_split_q3: input.splits.q3,
			p_split_final: input.splits.final,
			p_team_row_name: input.teams.row.name,
			p_team_col_name: input.teams.col.name,
			p_team_row_color: input.teams.row.color,
			p_team_col_color: input.teams.col.color,
			p_event_name: eventNameOrDefault(input.eventName),
			p_kickoff_at: input.kickoffAt || null,
		},
		{ failed: 'Failed to create party. Please try again.' }
	);
	if (!result.ok) return result;

	const party = parseParty(result.data.party);
	if (!party) {
		return {
			ok: false,
			error: 'Created party but the server returned an unexpected shape — please retry.',
		};
	}
	return { ok: true, party };
}
