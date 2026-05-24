import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import {
	getUserName,
	setUserName,
	clearUserName,
	getLocalItem,
	setLocalItem,
	removeLocalItem,
} from '$lib/storage';

const USER_NAME_STORAGE_KEY = 'squares_user_name';

function createUserStore() {
	// Initialize with localStorage value synchronously (for SSR compatibility)
	const stored = getLocalItem(USER_NAME_STORAGE_KEY);
	const { subscribe, set } = writable<string | null>(stored);

	// Async initialization from IndexedDB
	if (browser) {
		getUserName().then((name) => {
			if (name) {
				set(name);
				// Also update localStorage as sync fallback
				setLocalItem(USER_NAME_STORAGE_KEY, name);
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
				if (browser) {
					setLocalItem(USER_NAME_STORAGE_KEY, trimmed);
				}
				// Persist to IndexedDB
				await setUserName(trimmed);
			} else {
				set(null);
			}
		},
		clear: async () => {
			set(null);
			if (browser) {
				removeLocalItem(USER_NAME_STORAGE_KEY);
			}
			await clearUserName();
		},
	};
}

export const userName = createUserStore();

// Get the lowercase version for matching
export function normalizePlayerName(name: string): string {
	return name.trim().toLowerCase();
}
