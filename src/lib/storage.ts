import { get, set, del, keys } from 'idb-keyval';
import { browser } from '$app/environment';
import type { RecentParty, PartyStatus } from './types';

const STORAGE_KEYS = {
	userName: 'squares_user_name',
	recentParties: 'squares_recent_parties',
	hostPins: 'squares_host_pins',
	gestureHintShown: 'squares_gesture_hint_shown',
} as const;

const MAX_RECENT_PARTIES = 10;
const PARTY_EXPIRY_DAYS = 90;

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
		// Fallback to localStorage
		return localStorage.getItem(STORAGE_KEYS.userName);
	}
}

export async function setUserName(name: string): Promise<void> {
	if (!browser) return;

	const trimmed = name.trim();
	if (!trimmed) return;

	try {
		await set(STORAGE_KEYS.userName, trimmed);
	} catch {
		// Fallback to localStorage
		localStorage.setItem(STORAGE_KEYS.userName, trimmed);
	}
}

export async function clearUserName(): Promise<void> {
	if (!browser) return;

	try {
		await del(STORAGE_KEYS.userName);
	} catch {
		localStorage.removeItem(STORAGE_KEYS.userName);
	}
}

// Recent parties storage
export async function getRecentParties(): Promise<RecentParty[]> {
	if (!browser) return [];

	try {
		const parties = await get<RecentParty[]>(STORAGE_KEYS.recentParties);
		if (!parties) return [];

		// Filter out expired parties
		const now = Date.now();
		const expiryMs = PARTY_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
		return parties.filter((p) => now - p.lastVisited < expiryMs);
	} catch {
		// Try localStorage fallback
		try {
			const stored = localStorage.getItem(STORAGE_KEYS.recentParties);
			return stored ? JSON.parse(stored) : [];
		} catch {
			return [];
		}
	}
}

export async function saveRecentParty(party: RecentParty): Promise<void> {
	if (!browser) return;

	try {
		let parties = await getRecentParties();

		// Remove existing entry for this party code
		parties = parties.filter((p) => p.code !== party.code);

		// Add new entry at the beginning
		parties.unshift(party);

		// Keep only MAX_RECENT_PARTIES
		parties = parties.slice(0, MAX_RECENT_PARTIES);

		await set(STORAGE_KEYS.recentParties, parties);
	} catch {
		// Fallback to localStorage
		try {
			let parties = await getRecentParties();
			parties = parties.filter((p) => p.code !== party.code);
			parties.unshift(party);
			parties = parties.slice(0, MAX_RECENT_PARTIES);
			localStorage.setItem(STORAGE_KEYS.recentParties, JSON.stringify(parties));
		} catch {
			// Silently fail
		}
	}
}

export async function removeRecentParty(code: string): Promise<void> {
	if (!browser) return;

	try {
		let parties = await getRecentParties();
		parties = parties.filter((p) => p.code !== code);
		await set(STORAGE_KEYS.recentParties, parties);
	} catch {
		// Fallback to localStorage
		try {
			let parties = await getRecentParties();
			parties = parties.filter((p) => p.code !== code);
			localStorage.setItem(STORAGE_KEYS.recentParties, JSON.stringify(parties));
		} catch {
			// Silently fail
		}
	}
}

// Host PIN storage
export async function getHostPin(code: string): Promise<string | null> {
	if (!browser) return null;

	try {
		const pins = await get<Record<string, string>>(STORAGE_KEYS.hostPins);
		return pins?.[code] ?? null;
	} catch {
		// Fallback to sessionStorage (original behavior)
		return sessionStorage.getItem(`squares_pin_${code}`);
	}
}

export async function setHostPin(code: string, pin: string): Promise<void> {
	if (!browser) return;

	try {
		const pins = (await get<Record<string, string>>(STORAGE_KEYS.hostPins)) ?? {};
		pins[code] = pin;
		await set(STORAGE_KEYS.hostPins, pins);
	} catch {
		// Fallback to sessionStorage
		sessionStorage.setItem(`squares_pin_${code}`, pin);
	}
}

export async function removeHostPin(code: string): Promise<void> {
	if (!browser) return;

	try {
		const pins = (await get<Record<string, string>>(STORAGE_KEYS.hostPins)) ?? {};
		delete pins[code];
		await set(STORAGE_KEYS.hostPins, pins);
	} catch {
		sessionStorage.removeItem(`squares_pin_${code}`);
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
		return localStorage.getItem(STORAGE_KEYS.gestureHintShown) === 'true';
	}
}

export async function markGestureHintSeen(): Promise<void> {
	if (!browser) return;

	try {
		await set(STORAGE_KEYS.gestureHintShown, true);
	} catch {
		localStorage.setItem(STORAGE_KEYS.gestureHintShown, 'true');
	}
}
