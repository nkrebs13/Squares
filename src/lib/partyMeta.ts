import { APP_CONFIG } from '$lib/config';
import type { Party } from '$lib/types';

export interface PartyShareMetadata {
	code: string;
	eventName: string;
	kickoffAt: string | null;
	status: Party['status'];
	teamRowName: string;
	teamColName: string;
}

export function partyToShareMetadata(party: Party): PartyShareMetadata {
	return {
		code: party.code,
		eventName: party.event_name,
		kickoffAt: party.kickoff_at,
		status: party.status,
		teamRowName: party.team_row_name,
		teamColName: party.team_col_name,
	};
}

export function buildPartyPageTitle(meta: PartyShareMetadata | null | undefined): string {
	if (!meta) return APP_CONFIG.appName;
	return `${APP_CONFIG.appName} — ${meta.eventName}: ${meta.teamRowName} vs ${meta.teamColName}`;
}

export function buildPartyShareDescription(meta: PartyShareMetadata | null | undefined): string {
	if (!meta) return APP_CONFIG.appDescription;

	const matchup = `${meta.teamRowName} vs ${meta.teamColName}`;
	const statusCopy =
		meta.status === 'complete'
			? 'See final scores, winners, and payouts.'
			: meta.status === 'active' || meta.status === 'locked'
				? 'Follow scores and quarter winners in real time.'
				: 'Claim squares before kickoff and track winners quarter by quarter in real time.';

	return `Join ${meta.eventName}: ${matchup} football squares. ${statusCopy}`;
}

export function buildPartyCanonicalUrl(code: string): string {
	const appUrl = APP_CONFIG.appUrl.replace(/\/$/, '');
	return `${appUrl}/party/${code}`;
}
