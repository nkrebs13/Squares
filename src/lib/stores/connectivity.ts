import { writable, type Readable } from 'svelte/store';
import { browser } from '$app/environment';

// Browser network connectivity: navigator.onLine plus the window
// 'online'/'offline' events. Independent of game-realtime's connectionStatus,
// which only tracks the Supabase realtime channels: a user can be offline while
// that still reads 'connected' from its last known state, or the reverse.
// SSR-safe: navigator/window are only touched in the browser.
const _isOffline = writable<boolean>(browser ? !navigator.onLine : false);

/** Whether the browser reports no network connection. */
export const isOffline: Readable<boolean> = { subscribe: _isOffline.subscribe };

const setOnline = () => _isOffline.set(false);
const setOffline = () => _isOffline.set(true);
let listening = false;

/** Resync from navigator.onLine and start listening (idempotent). */
export function watchConnectivity(): void {
	if (!browser) return;
	_isOffline.set(!navigator.onLine);
	if (listening) return;
	window.addEventListener('online', setOnline);
	window.addEventListener('offline', setOffline);
	listening = true;
}

/** Stop listening and resync from navigator.onLine. */
export function unwatchConnectivity(): void {
	if (browser && listening) {
		window.removeEventListener('online', setOnline);
		window.removeEventListener('offline', setOffline);
		listening = false;
	}
	_isOffline.set(browser ? !navigator.onLine : false);
}
