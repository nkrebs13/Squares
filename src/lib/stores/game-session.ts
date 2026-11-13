import { get } from 'svelte/store';
import { party, gameScores, resetPartyState } from './game-state';
import { loadParty, refreshParty } from './game-load';
import { clearPendingOps, localChangeCount, pendingOperations } from './game-pending';
import { subscribeToParty, followGame, cleanupChannels } from './game-realtime';

/** How often an open, visible party is re-read regardless of Realtime. */
export const PARTY_REFRESH_MS = 60_000;

/** Bumped by every open and every cleanup; a load that finishes under an older value is stale. */
let session = 0;

/** Stops the open party's refresh triggers. */
let stopResync: (() => void) | null = null;

/**
 * Re-read the party quietly. Realtime can miss events: those sent before the party
 * channel joined, during a gap, or dropped by a rate limit while the socket looks fine
 * (HB-2437). The server rows replace the grid only when nothing newer is on screen: no
 * claim was in flight when the read started, and no op or row event arrived while it
 * was out. Otherwise the read is dropped and the next trigger heals.
 */
function quietRefresher(code: string, mine: number): () => void {
	// One read at a time: a trigger while one is out queues exactly one more after it,
	// so reads slower than the poll still land, and none answers out of order.
	let reading = false;
	let again = false;
	const run = (): void => {
		// A trigger that outlived its party (a late channel join, a timer) reads nothing.
		if (mine !== session) return;
		// A claim in flight may commit after the read: its snapshot would undo it on screen.
		if (get(pendingOperations).size > 0) return;
		if (reading) {
			again = true;
			return;
		}
		reading = true;
		again = false;
		const changesAtStart = localChangeCount();
		// Anything the user, the host or Realtime changed while the read was out is newer
		// than it; the read is dropped and the next one picks it all up.
		const isCurrent = () => mine === session && localChangeCount() === changesAtStart;
		void refreshParty(code, isCurrent).finally(() => {
			reading = false;
			if (again) run();
		});
	};
	return run;
}

/**
 * Re-read while the page is looked at: when it becomes visible again (a phone screen
 * waking) and every PARTY_REFRESH_MS.
 */
function refreshWhileVisible(refresh: () => void): () => void {
	if (typeof document === 'undefined') return () => {};
	const onVisibility = () => {
		if (document.visibilityState === 'visible') refresh();
	};
	const timer = setInterval(onVisibility, PARTY_REFRESH_MS);
	document.addEventListener('visibilitychange', onVisibility);
	return () => {
		clearInterval(timer);
		document.removeEventListener('visibilitychange', onVisibility);
	};
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
	stopResync?.();
	const refresh = quietRefresher(code, mine);
	// Each join of the party channel (the first, and every rejoin after a gap) re-reads,
	// since nothing from before the join will arrive.
	subscribeToParty(current.id, followedGame, refresh);
	const stopVisibleRefresh = refreshWhileVisible(refresh);
	// The game channel follows the party's game: its linked one, else the one the
	// server detects from its team names. Only that channel is re-keyed.
	const follow = (gameId: string | null): boolean => {
		if (gameId === followedGame) return false;
		followedGame = gameId;
		followGame(gameId);
		return true;
	};
	// A game linked while the party is open (operators link out of band): re-read to
	// fetch its row. Renaming an unlinked party's teams changes which game it matches:
	// re-read to learn it.
	let teams = `${current.team_row_name}|${current.team_col_name}`;
	const stopPartyWatch = party.subscribe((p) => {
		if (mine !== session || !p || p.id !== current.id) return;
		if (p.game_id && follow(p.game_id)) refresh();
		const nowTeams = `${p.team_row_name}|${p.team_col_name}`;
		if (nowTeams !== teams) {
			teams = nowTeams;
			if (!p.game_id) refresh();
		}
	});
	// An unlinked party follows whatever game the last read detected, or none.
	const stopDetectedWatch = gameScores.subscribe((game) => {
		const p = get(party);
		if (mine !== session || !p || p.id !== current.id || p.game_id) return;
		follow(game?.game_id ?? null);
	});
	stopResync = () => {
		stopVisibleRefresh();
		stopPartyWatch();
		stopDetectedWatch();
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
