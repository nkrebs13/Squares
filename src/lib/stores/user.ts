import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
	getUserName,
	setUserName,
	clearUserName,
	getLocalItem,
	setLocalItem,
	removeLocalItem,
	STORAGE_KEYS,
} from '$lib/storage';

function createUserStore() {
	// Initialize with localStorage value synchronously (for SSR compatibility)
	const stored = getLocalItem(STORAGE_KEYS.userName);
	const { subscribe, set } = writable<string | null>(stored);

	// Async initialization from IndexedDB
	if (browser) {
		getUserName().then((name) => {
			if (name) {
				set(name);
				// Also update localStorage as sync fallback
				setLocalItem(STORAGE_KEYS.userName, name);
			}
		});
	}

	return {
		subscribe,
		setName: async (name: string) => {
			const trimmed = name.trim();
			if (trimmed) {
				// Update store immediately
				set(trimmed);
				// Sync to localStorage for immediate fallback
				setLocalItem(STORAGE_KEYS.userName, trimmed);
				// Persist to IndexedDB
				await setUserName(trimmed);
			} else {
				set(null);
			}
		},
		clear: async () => {
			set(null);
			removeLocalItem(STORAGE_KEYS.userName);
			await clearUserName();
		},
	};
}

export const userName = createUserStore();

// Get the lowercase version for matching
export function normalizePlayerName(name: string): string {
	return name.trim().toLowerCase();
}
