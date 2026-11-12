import { get } from 'svelte/store';
import { party, gameScores, resetPartyState } from './game-state';
import { loadParty } from './game-load';
import { clearPendingOps } from './game-pending';
import { subscribeToParty, cleanupChannels } from './game-realtime';

/** Bumped by every open and every cleanup; a load that finishes under an older value is stale. */
let session = 0;

/**
 * Enter a party: load its state, then follow it live (including its game, linked or
 * only detected). Returns false when the party could not be loaded, or when the party
 * was left before it finished loading. Leave with cleanup().
 */
export async function openParty(code: string): Promise<boolean> {
	const mine = ++session;
	if (!(await loadParty(code, () => mine === session))) return false;
	const current = get(party);
	if (!current) return false;
	subscribeToParty(current.id, current.game_id ?? get(gameScores)?.game_id ?? null);
	return true;
}

/** Leave the party: drop pending ops, tear every channel down, reset all party state. */
export function cleanup() {
	session++;
	clearPendingOps();
	cleanupChannels();
	resetPartyState();
}
