import { get } from 'svelte/store';
import { party, gameScores, resetPartyState } from './game-state';
import { loadParty } from './game-load';
import { clearPendingOps } from './game-pending';
import { subscribeToParty, cleanupChannels } from './game-realtime';

/**
 * Enter a party: load its state, then follow it live (including its game, linked or
 * only detected). Returns false when the party could not be loaded. Leave with cleanup().
 */
export async function openParty(code: string): Promise<boolean> {
	if (!(await loadParty(code))) return false;
	const current = get(party);
	if (!current) return false;
	subscribeToParty(current.id, current.game_id ?? get(gameScores)?.game_id ?? null);
	return true;
}

/** Leave the party: drop pending ops, tear every channel down, reset all party state. */
export function cleanup() {
	clearPendingOps();
	cleanupChannels();
	resetPartyState();
}
