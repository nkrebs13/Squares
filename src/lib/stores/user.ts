import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { getUserName, setUserName, clearUserName } from '$lib/storage';

function createUserStore() {
	// Initialize with localStorage value synchronously (for SSR compatibility)
	const stored = browser ? localStorage.getItem('squares_user_name') : null;
	const { subscribe, set } = writable<string | null>(stored);

	// Async initialization from IndexedDB
	if (browser) {
		getUserName().then((name) => {
			if (name) {
				set(name);
				// Also update localStorage as sync fallback
				localStorage.setItem('squares_user_name', name);
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
					localStorage.setItem('squares_user_name', trimmed);
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
				localStorage.removeItem('squares_user_name');
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
