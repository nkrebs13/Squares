import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { durable, local, STORAGE_KEYS } from '$lib/storage';

// The player's name: in IndexedDB, mirrored to localStorage so the first render
// (before IndexedDB answers) already knows it.
const stored = durable<string>(STORAGE_KEYS.userName, {
	encode: (name) => name,
	decode: (raw) => raw,
});

function createUserStore() {
	const { subscribe, set } = writable<string | null>(local.get(STORAGE_KEYS.userName));
	let changedLocally = false;

	if (browser) {
		stored.get().then((name) => {
			// Don't overwrite a name the user set while IndexedDB was answering.
			if (name && !changedLocally) {
				set(name);
				local.set(STORAGE_KEYS.userName, name);
			}
		});
	}

	return {
		subscribe,
		setName: async (name: string) => {
			changedLocally = true;
			const trimmed = name.trim();
			if (!trimmed) {
				set(null);
				return;
			}
			set(trimmed);
			local.set(STORAGE_KEYS.userName, trimmed);
			await stored.set(trimmed);
		},
		clear: async () => {
			changedLocally = true;
			set(null);
			local.remove(STORAGE_KEYS.userName);
			await stored.remove();
		},
	};
}

export const userName = createUserStore();
