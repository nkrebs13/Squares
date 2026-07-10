import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { subscribeToParty, cleanup, isOffline } from '$lib/stores/game';
import { userName } from '$lib/stores/user';

describe('isOffline store', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('initial value reflects navigator.onLine (jsdom default: online)', () => {
		expect(get(isOffline)).toBe(false);
	});

	it('flips true on a window "offline" event and back to false on "online"', () => {
		subscribeToParty('test-party-id');

		window.dispatchEvent(new Event('offline'));
		expect(get(isOffline)).toBe(true);

		window.dispatchEvent(new Event('online'));
		expect(get(isOffline)).toBe(false);
	});

	it('registers the online/offline listeners exactly once across repeated subscribeToParty calls', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');

		subscribeToParty('party-a');
		subscribeToParty('party-b');

		const onlineRegistrations = addSpy.mock.calls.filter(([type]) => type === 'online').length;
		const offlineRegistrations = addSpy.mock.calls.filter(([type]) => type === 'offline').length;
		expect(onlineRegistrations).toBe(1);
		expect(offlineRegistrations).toBe(1);
	});

	it('removes the listeners on cleanup so a later offline event no longer flips the store', () => {
		subscribeToParty('test-party-id');
		cleanup();

		window.dispatchEvent(new Event('offline'));
		expect(get(isOffline)).toBe(false);
	});

	it('removing listeners on cleanup calls window.removeEventListener for both events', () => {
		const removeSpy = vi.spyOn(window, 'removeEventListener');

		subscribeToParty('test-party-id');
		cleanup();

		expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
		expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
	});
});
