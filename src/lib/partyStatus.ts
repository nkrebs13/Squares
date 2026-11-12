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

/** The one rule for "this user can act on the grid" (claim, unclaim, drag-select). */
export function canActOnGrid(
	status: PartyStatus | undefined,
	userName: string | null | undefined
): boolean {
	return !!userName && isFilling(status);
}

/** The grid is locked and the game is being scored. `locked` is legacy (see types.ts). */
export function isGameInProgress(status: PartyStatus | undefined): boolean {
	return status === 'active' || status === 'locked';
}

/** The game is over and every winner is decided. */
export function isComplete(status: PartyStatus | undefined): boolean {
	return status === 'complete';
}

/** Numbers are drawn: the game is being scored or is over. */
export function hasDrawnNumbers(status: PartyStatus | undefined): boolean {
	return isGameInProgress(status) || isComplete(status);
}

/** How a status reads in the UI (legacy `locked` reads as active). */
export function statusLabel(status: PartyStatus): string {
	return status === 'locked' ? 'active' : status;
}

export type StatusTone = 'filling' | 'live' | 'locked' | 'done';

/** The recent-parties badge for a status: its text and a semantic tone (the view maps tone to style). */
export function getStatusBadge(status: PartyStatus): { text: string; tone: StatusTone } {
	switch (status) {
		case 'filling':
			return { text: 'Filling', tone: 'filling' };
		case 'locked':
			return { text: 'Locked', tone: 'locked' };
		case 'active':
			return { text: 'Live', tone: 'live' };
		case 'complete':
			return { text: 'Done', tone: 'done' };
	}
}
