import { APP_CONFIG } from '$lib/config';
import { formatKickoff } from '$lib/utils/datetime';
import type { RecentParty, PartyStatus } from '$lib/types';

export const MAX_NICKNAME_LENGTH = 30;

export function getStatusBadge(status: PartyStatus): { text: string; class: string } {
	switch (status) {
		case 'filling':
			return { text: 'Filling', class: 'badge-filling' };
		case 'locked':
			return { text: 'Locked', class: 'badge-locked' };
		case 'active':
			return { text: 'Live', class: 'badge-active' };
		case 'complete':
			return { text: 'Done', class: 'badge-complete' };
		default:
			return { text: status, class: '' };
	}
}

function isSameLabel(first: string, second: string): boolean {
	return first.trim().toLowerCase() === second.trim().toLowerCase();
}

function getMatchup(party: RecentParty): string {
	return `${party.teamRowName} vs ${party.teamColName}`;
}

function getSpecificEventName(party: RecentParty, matchup: string): string | null {
	const eventName = party.eventName?.trim();
	if (!eventName || eventName === matchup || eventName === APP_CONFIG.defaultEventName) {
		return null;
	}
	return eventName;
}

export function getDisplayName(party: RecentParty): string {
	if (party.nickname) {
		return party.nickname;
	}
	const matchup = getMatchup(party);
	return getSpecificEventName(party, matchup) ?? matchup;
}

export function getDetailLine(party: RecentParty): string {
	const matchup = getMatchup(party);
	const kickoff = formatKickoff(party.kickoffAt);
	const specificEventName = getSpecificEventName(party, matchup);

	if (!party.nickname && !specificEventName) return kickoff || '';

	const details = [];
	if (party.nickname && specificEventName && !isSameLabel(party.nickname, specificEventName)) {
		details.push(specificEventName);
	}
	details.push(matchup);
	if (kickoff) details.push(kickoff);
	return details.join(' - ');
}
