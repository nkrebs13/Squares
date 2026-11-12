import { formatMatchup } from '$lib/utils/format';
import { isComplete, isGameInProgress } from '$lib/partyStatus';
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
	return `${APP_CONFIG.appName} — ${meta.eventName}: ${formatMatchup(meta.teamRowName, meta.teamColName)}`;
}

export function buildPartyShareDescription(meta: PartyShareMetadata | null | undefined): string {
	if (!meta) return APP_CONFIG.appDescription;

	const matchup = formatMatchup(meta.teamRowName, meta.teamColName);
	const statusCopy = isComplete(meta.status)
		? 'See final scores, winners, and payouts.'
		: isGameInProgress(meta.status)
			? 'Follow scores and quarter winners in real time.'
			: 'Claim squares before kickoff and track winners quarter by quarter in real time.';

	return `Join ${meta.eventName}: ${matchup} ${APP_CONFIG.appName.toLowerCase()}. ${statusCopy}`;
}

export function buildPartyCanonicalUrl(code: string): string {
	const appUrl = APP_CONFIG.appUrl.replace(/\/$/, '');
	return `${appUrl}/party/${code}`;
}
