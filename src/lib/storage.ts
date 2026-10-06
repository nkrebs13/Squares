import { get, set, del } from 'idb-keyval';
import { browser } from '$app/environment';
import type { RecentParty } from './types';

export const STORAGE_KEYS = {
	userName: 'squares_user_name',
	recentParties: 'squares_recent_parties',
	hostPins: 'squares_host_pins',
	gestureHintShown: 'squares_gesture_hint_shown',
} as const;

export const partyPinKey = (code: string) => `squares_pin_${code}`;
export const partyNicknameKey = (code: string) => `squares_nickname_${code}`;

const MAX_RECENT_PARTIES = 10;
const PARTY_EXPIRY_DAYS = 90;

// Web Storage access can throw (blocked storage, quota, or even reading the
// `localStorage`/`sessionStorage` global itself), so `resolve` is called lazily
// inside the try block. All helpers no-op safely off the browser.
function makeStorage(resolve: () => Storage) {
	return {
		get(key: string): string | null {
			if (!browser) return null;
			try {
				return resolve().getItem(key);
			} catch {
				return null;
			}
		},
		set(key: string, value: string): boolean {
			if (!browser) return false;
			try {
				resolve().setItem(key, value);
				return true;
			} catch {
				return false;
			}
		},
		remove(key: string): boolean {
			if (!browser) return false;
			try {
				resolve().removeItem(key);
				return true;
			} catch {
				return false;
			}
		},
	};
}

const localStore = makeStorage(() => localStorage);
const sessionStore = makeStorage(() => sessionStorage);

export const getLocalItem = (key: string): string | null => localStore.get(key);
export const setLocalItem = (key: string, value: string): boolean => localStore.set(key, value);
export const removeLocalItem = (key: string): boolean => localStore.remove(key);
export const getSessionItem = (key: string): string | null => sessionStore.get(key);
export const setSessionItem = (key: string, value: string): boolean => sessionStore.set(key, value);
export const removeSessionItem = (key: string): boolean => sessionStore.remove(key);

// Request persistent storage for better data durability
export async function requestPersistentStorage(): Promise<boolean> {
	if (!browser || !navigator.storage?.persist) return false;

	try {
		const isPersisted = await navigator.storage.persisted();
		if (!isPersisted) {
			return await navigator.storage.persist();
		}
		return isPersisted;
	} catch {
		return false;
	}
}

// User name storage
export async function getUserName(): Promise<string | null> {
	if (!browser) return null;

	try {
		const name = await get<string>(STORAGE_KEYS.userName);
		return name ?? null;
	} catch {
		return getLocalItem(STORAGE_KEYS.userName);
	}
}

export async function setUserName(name: string): Promise<void> {
	if (!browser) return;

	const trimmed = name.trim();
	if (!trimmed) return;

	try {
		await set(STORAGE_KEYS.userName, trimmed);
	} catch {
		setLocalItem(STORAGE_KEYS.userName, trimmed);
	}
}

export async function clearUserName(): Promise<void> {
	if (!browser) return;

	try {
		await del(STORAGE_KEYS.userName);
	} catch {
		removeLocalItem(STORAGE_KEYS.userName);
	}
}

// Recent parties storage
function withoutExpired(parties: RecentParty[]): RecentParty[] {
	const expiryMs = PARTY_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
	const now = Date.now();
	return parties.filter((p) => now - p.lastVisited < expiryMs);
}

function getLocalRecentParties(): RecentParty[] {
	try {
		const stored = getLocalItem(STORAGE_KEYS.recentParties);
		return stored ? withoutExpired(JSON.parse(stored)) : [];
	} catch {
		return [];
	}
}

export async function getRecentParties(): Promise<RecentParty[]> {
	if (!browser) return [];

	try {
		const parties = await get<RecentParty[]>(STORAGE_KEYS.recentParties);
		// No IndexedDB entry: the list may live in localStorage (see mutateRecentParties).
		return parties ? withoutExpired(parties) : getLocalRecentParties();
	} catch {
		return getLocalRecentParties();
	}
}

// Read-modify-write the recent-parties list: IndexedDB first, localStorage if the
// IndexedDB write fails. `fn` must be pure — it is re-applied on the fallback path.
// When IndexedDB can still be read but not written (e.g. quota exceeded), the stale
// IndexedDB entry is deleted so getRecentParties falls through to localStorage;
// otherwise every later read would return the IndexedDB list and drop this write.
async function mutateRecentParties(fn: (parties: RecentParty[]) => RecentParty[]): Promise<void> {
	try {
		await set(STORAGE_KEYS.recentParties, fn(await getRecentParties()));
	} catch {
		try {
			setLocalItem(STORAGE_KEYS.recentParties, JSON.stringify(fn(await getRecentParties())));
			await del(STORAGE_KEYS.recentParties).catch(() => {});
		} catch {
			// Silently fail
		}
	}
}

export async function saveRecentParty(party: RecentParty): Promise<void> {
	if (!browser) return;

	await mutateRecentParties((parties) => {
		// Find existing entry to preserve nickname
		const existingParty = parties.find((p) => p.code === party.code);
		const partyWithNickname = {
			...party,
			nickname: party.nickname ?? existingParty?.nickname,
		};

		// Replace any existing entry for this code, newest first, capped
		return [partyWithNickname, ...parties.filter((p) => p.code !== party.code)].slice(
			0,
			MAX_RECENT_PARTIES
		);
	});
}

export async function removeRecentParty(code: string): Promise<void> {
	if (!browser) return;

	await mutateRecentParties((parties) => parties.filter((p) => p.code !== code));
}

export async function updatePartyNickname(code: string, nickname: string): Promise<void> {
	if (!browser) return;

	const trimmedNickname = nickname.trim() || undefined;

	await mutateRecentParties((parties) =>
		parties.map((p) => (p.code === code ? { ...p, nickname: trimmedNickname } : p))
	);
}

// Host PIN storage
export async function getHostPin(code: string): Promise<string | null> {
	if (!browser) return null;

	try {
		const pins = await get<Record<string, string>>(STORAGE_KEYS.hostPins);
		return pins?.[code] ?? getSessionItem(partyPinKey(code));
	} catch {
		return getSessionItem(partyPinKey(code));
	}
}

export async function setHostPin(code: string, pin: string): Promise<void> {
	if (!browser) return;

	try {
		const pins = (await get<Record<string, string>>(STORAGE_KEYS.hostPins)) ?? {};
		pins[code] = pin;
		await set(STORAGE_KEYS.hostPins, pins);
	} catch {
		setSessionItem(partyPinKey(code), pin);
	}
}

export async function removeHostPin(code: string): Promise<void> {
	if (!browser) return;

	try {
		const pins = (await get<Record<string, string>>(STORAGE_KEYS.hostPins)) ?? {};
		delete pins[code];
		await set(STORAGE_KEYS.hostPins, pins);
	} catch {
		removeSessionItem(partyPinKey(code));
	}
}

export async function hasHostPin(code: string): Promise<boolean> {
	const pin = await getHostPin(code);
	return pin !== null;
}

// Gesture hint storage
export async function hasSeenGestureHint(): Promise<boolean> {
	if (!browser) return true;

	try {
		const seen = await get<boolean>(STORAGE_KEYS.gestureHintShown);
		return seen === true;
	} catch {
		return getLocalItem(STORAGE_KEYS.gestureHintShown) === 'true';
	}
}

export async function markGestureHintSeen(): Promise<void> {
	if (!browser) return;

	try {
		await set(STORAGE_KEYS.gestureHintShown, true);
	} catch {
		setLocalItem(STORAGE_KEYS.gestureHintShown, 'true');
	}
}
