import type { PartyStatus } from '$lib/types';

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
