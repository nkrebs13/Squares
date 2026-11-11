// The host PIN a browser remembers per party, so the host isn't asked again.
// Kept in IndexedDB (survives the tab) and in sessionStorage (this tab only).
// Never in localStorage: when IndexedDB is unavailable the PIN lasts as long as
// the tab, as before. Every caller goes through these functions.

import { durable, session, STORAGE_KEYS } from '$lib/storage';

const pins = durable<Record<string, string>>(STORAGE_KEYS.hostPins, null);

export async function rememberHostPin(code: string, pin: string): Promise<void> {
	session.set(STORAGE_KEYS.partyPin(code), pin);
	await pins.set({ ...((await pins.get()) ?? {}), [code]: pin });
}

/** The PIN this tab already holds, synchronously (so a host's page renders authorized at once). */
export function cachedHostPin(code: string): string | null {
	return session.get(STORAGE_KEYS.partyPin(code));
}

export async function recallHostPin(code: string): Promise<string | null> {
	return cachedHostPin(code) ?? (await pins.get())?.[code] ?? null;
}

export async function forgetHostPin(code: string): Promise<void> {
	session.remove(STORAGE_KEYS.partyPin(code));
	const current = (await pins.get()) ?? {};
	if (code in current) {
		const { [code]: _forgotten, ...rest } = current;
		await pins.set(rest);
	}
}
