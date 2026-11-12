// The parties this browser has visited, newest first, for the home page.
// IndexedDB with a localStorage fallback (see mutate below).

import { browser } from '$app/environment';
import { get, set } from 'idb-keyval';
import type { RecentParty } from '$lib/types';
import { PARTY_STATUSES, type PartyStatus } from '$lib/partyStatus';
import { local, session, STORAGE_KEYS } from '$lib/storage';

const MAX_RECENT_PARTIES = 10;
/** How many of the stored parties the home page lists. */
export const HOME_RECENT_PARTIES = 5;
const EXPIRY_MS = 90 * 24 * 60 * 60 * 1000;

// Stored lists come from browsers that may hold entries written by older builds, so an
// entry with an unknown status is dropped rather than reaching the exhaustive badge switch.
function usable(parties: RecentParty[]): RecentParty[] {
	const now = Date.now();
	return parties.filter(
		(p) => now - p.lastVisited < EXPIRY_MS && PARTY_STATUSES.includes(p.status as PartyStatus)
	);
}

function readLocal(): RecentParty[] {
	try {
		const stored = local.get(STORAGE_KEYS.recentParties);
		return stored ? usable(JSON.parse(stored)) : [];
	} catch {
		return [];
	}
}

export async function getRecentParties(): Promise<RecentParty[]> {
	if (!browser) return [];

	// A failed IndexedDB write left the newer list in localStorage (see mutate).
	if (local.get(STORAGE_KEYS.recentPartiesInLocal)) return readLocal();

	try {
		const parties = await get<RecentParty[]>(STORAGE_KEYS.recentParties);
		return parties ? usable(parties) : [];
	} catch {
		return readLocal();
	}
}

// Read-modify-write: IndexedDB first, localStorage if the IndexedDB write fails.
// `fn` must be pure: it is re-applied on the fallback path. IndexedDB can stay
// readable while writes fail (quota), so a fallback write also sets a marker
// that makes getRecentParties read localStorage until the next IndexedDB write.
async function mutate(fn: (parties: RecentParty[]) => RecentParty[]): Promise<void> {
	if (!browser) return;
	try {
		await set(STORAGE_KEYS.recentParties, fn(await getRecentParties()));
		local.remove(STORAGE_KEYS.recentPartiesInLocal);
	} catch {
		const next = JSON.stringify(fn(await getRecentParties()));
		if (local.set(STORAGE_KEYS.recentParties, next)) {
			local.set(STORAGE_KEYS.recentPartiesInLocal, '1');
		}
	}
}

/**
 * Hold a nickname chosen on the create or join page until the party page
 * records the visit (saveRecentParty), which is when the entry exists.
 */
export function stageNickname(code: string, nickname: string): void {
	const trimmed = nickname.trim();
	if (trimmed) session.set(STORAGE_KEYS.partyNickname(code), trimmed);
}

/** Record a visit (newest first, capped). Keeps an existing or staged nickname. */
export async function saveRecentParty(party: RecentParty): Promise<void> {
	const stagedKey = STORAGE_KEYS.partyNickname(party.code);
	const staged = session.get(stagedKey) ?? undefined;

	await mutate((parties) => {
		const existing = parties.find((p) => p.code === party.code);
		const entry = { ...party, nickname: party.nickname ?? staged ?? existing?.nickname };
		return [entry, ...parties.filter((p) => p.code !== party.code)].slice(0, MAX_RECENT_PARTIES);
	});
	if (staged) session.remove(stagedKey);
}

export async function removeRecentParty(code: string): Promise<void> {
	await mutate((parties) => parties.filter((p) => p.code !== code));
}

export async function updatePartyNickname(code: string, nickname: string): Promise<void> {
	const trimmed = nickname.trim() || undefined;
	await mutate((parties) =>
		parties.map((p) => (p.code === code ? { ...p, nickname: trimmed } : p))
	);
}
