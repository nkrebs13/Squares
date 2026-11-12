/**
 * 'locked' exists in the DB CHECK constraint and frontend rendering but is never
 * set by current RPCs: host_lock_party jumps directly to 'active'. Do not remove it.
 */
export const PARTY_STATUSES = ['filling', 'locked', 'active', 'complete'] as const;
export type PartyStatus = (typeof PARTY_STATUSES)[number];

/** Squares can still be claimed. */
export function isFilling(status: PartyStatus | undefined): boolean {
	return status === 'filling';
}

/** The grid is locked and the game is being scored. `locked` is legacy (see types.ts). */
export function isGameInProgress(status: PartyStatus | undefined): boolean {
	return status === 'active' || status === 'locked';
}

/** Numbers are drawn: the game is being scored or is over. */
export function hasDrawnNumbers(status: PartyStatus | undefined): boolean {
	return isGameInProgress(status) || status === 'complete';
}

/** How a status reads in the UI (legacy `locked` reads as active). */
export function statusLabel(status: PartyStatus): string {
	return status === 'locked' ? 'active' : status;
}

/** The recent-parties badge for a status: its text and CSS class. */
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
