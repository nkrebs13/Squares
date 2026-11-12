import { get } from 'svelte/store';
import { party, gameScores, resetPartyState } from './game-state';
import { loadParty, refreshParty } from './game-load';
import { clearPendingOps } from './game-pending';
import { subscribeToParty, cleanupChannels, connectionStatus } from './game-realtime';

/** Bumped by every open and every cleanup; a load that finishes under an older value is stale. */
let session = 0;

/** Stops the reconnect watcher of the open party. */
let stopResync: (() => void) | null = null;

/**
 * Re-read the party each time the realtime connection comes back after a gap, since
 * events sent during the gap are gone for good. The server rows replace the grid, and
 * pending ops end with them (as applySquareUpdate ends an op on a postgres_changes
 * UPDATE): the DB is the source of truth, and an op left alive would time out and roll
 * a square back to its pre-gap snapshot over the fresh row.
 */
function quietRefresher(code: string, mine: number): () => void {
	// Only the newest refresh may apply: two quick refreshes must not let an older
	// response land last and put the party back a step (e.g. complete -> filling).
	let latest = 0;
	return () => {
		const refresh = ++latest;
		const isCurrent = () => mine === session && refresh === latest;
		void refreshParty(code, isCurrent).then((applied) => {
			if (applied && isCurrent()) clearPendingOps();
		});
	};
}

function resyncOnReconnect(refresh: () => void): () => void {
	let previous: string | null = null;
	return connectionStatus.subscribe(({ status }) => {
		const reconnected = previous !== null && previous !== 'connected' && status === 'connected';
		previous = status;
		if (reconnected) refresh();
	});
}

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
	let followedGame = current.game_id ?? get(gameScores)?.game_id ?? null;
	subscribeToParty(current.id, followedGame);
	stopResync?.();
	const refresh = quietRefresher(code, mine);
	const stopReconnectWatch = resyncOnReconnect(refresh);
	// A party linked to a game while it is open (operators link out of band) needs the
	// game's channel too, or live scores never arrive until a reload. Resubscribing
	// rejoins every channel, so re-read once: it also fetches the newly linked game.
	const stopGameWatch = party.subscribe((p) => {
		if (mine !== session || !p || p.id !== current.id || !p.game_id) return;
		if (p.game_id === followedGame) return;
		followedGame = p.game_id;
		subscribeToParty(p.id, followedGame);
		refresh();
	});
	stopResync = () => {
		stopReconnectWatch();
		stopGameWatch();
	};
	return true;
}

/** Leave the party: drop pending ops, tear every channel down, reset all party state. */
export function cleanup() {
	session++;
	stopResync?.();
	stopResync = null;
	clearPendingOps();
	cleanupChannels();
	resetPartyState();
}
