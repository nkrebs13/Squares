import { writable } from 'svelte/store';
import { browser } from '$app/environment';

function createUserStore() {
	const stored = browser ? localStorage.getItem('squares_user_name') : null;
	const { subscribe, set, update } = writable<string | null>(stored);

	return {
		subscribe,
		setName: (name: string) => {
			const trimmed = name.trim();
			if (browser && trimmed) {
				localStorage.setItem('squares_user_name', trimmed);
			}
			set(trimmed || null);
		},
		clear: () => {
			if (browser) {
				localStorage.removeItem('squares_user_name');
			}
			set(null);
		}
	};
}

export const userName = createUserStore();

// Get the lowercase version for matching
export function normalizePlayerName(name: string): string {
	return name.trim().toLowerCase();
}
