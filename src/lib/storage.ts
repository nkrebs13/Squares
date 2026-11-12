// Browser storage primitives. Each feature keeps its own data in its own module
// (user name: stores/user.ts, host PINs: hostPin.ts, recent parties:
// recentParties.ts, gesture hint: GestureHint.svelte) on top of these.
//
// Key names are what users' browsers already hold: never rename one.

import { get, set, del } from 'idb-keyval';
import { browser } from '$app/environment';

export const STORAGE_KEYS = {
	userName: 'squares_user_name',
	recentParties: 'squares_recent_parties',
	// Set while localStorage holds a newer recent-parties list than IndexedDB.
	recentPartiesInLocal: 'squares_recent_parties_in_local',
	hostPins: 'squares_host_pins',
	gestureHintShown: 'squares_gesture_hint_shown',
	partyPin: (code: string) => `squares_pin_${code}`,
	partyNickname: (code: string) => `squares_nickname_${code}`,
} as const;

// Web Storage access can throw (blocked storage, quota, or even reading the
// `localStorage`/`sessionStorage` global itself), so `resolve` is called lazily
// inside the try block. Everything no-ops safely off the browser.
function webStorage(resolve: () => Storage) {
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

export const local = webStorage(() => localStorage);
export const session = webStorage(() => sessionStorage);

/** How a durable value is written to localStorage when IndexedDB is unavailable. */
export interface Codec<T> {
	encode(value: T): string;
	decode(raw: string): T | null;
}

/**
 * A value kept in IndexedDB, falling back to localStorage when IndexedDB
 * fails. A null codec means no fallback: the value is never written to
 * localStorage (for secrets that must not outlive IndexedDB's lifetime rules).
 */
export function durable<T>(key: string, codec: Codec<T> | null) {
	return {
		async get(): Promise<T | null> {
			if (!browser) return null;
			try {
				return (await get<T>(key)) ?? null;
			} catch {
				const raw = codec ? local.get(key) : null;
				return raw === null || !codec ? null : codec.decode(raw);
			}
		},
		/** Whether the value was stored (in either place). */
		async set(value: T): Promise<boolean> {
			if (!browser) return false;
			try {
				await set(key, value);
				return true;
			} catch {
				return codec ? local.set(key, codec.encode(value)) : false;
			}
		},
		async remove(): Promise<void> {
			if (!browser) return;
			try {
				await del(key);
			} catch {
				if (codec) local.remove(key);
			}
		},
	};
}

/** Ask the browser not to evict this site's storage. */
export async function requestPersistentStorage(): Promise<boolean> {
	if (!browser || !navigator.storage?.persist) return false;
	try {
		return (await navigator.storage.persisted()) || (await navigator.storage.persist());
	} catch {
		return false;
	}
}
