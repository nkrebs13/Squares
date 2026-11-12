import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { subscribeToParty, cleanup, isOffline } from '$lib/stores/game';
import { unwatchConnectivity, watchConnectivity } from '$lib/stores/connectivity';

describe('isOffline', () => {
	beforeEach(() => {
		cleanup();
		unwatchConnectivity();
	});

	afterEach(() => {
		unwatchConnectivity();
		vi.restoreAllMocks();
	});

	it('initial value reflects navigator.onLine (jsdom default: online)', () => {
		expect(get(isOffline)).toBe(false);
	});

	it('flips true on a window "offline" event and back to false on "online"', () => {
		watchConnectivity();

		window.dispatchEvent(new Event('offline'));
		expect(get(isOffline)).toBe(true);

		window.dispatchEvent(new Event('online'));
		expect(get(isOffline)).toBe(false);
	});

	it('registers the online/offline listeners exactly once across repeated watch calls', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');

		watchConnectivity();
		watchConnectivity();

		expect(addSpy.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1);
		expect(addSpy.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(1);
	});

	it('removes both listeners when unwatched, so a later offline event no longer flips the store', () => {
		const removeSpy = vi.spyOn(window, 'removeEventListener');
		watchConnectivity();

		unwatchConnectivity();
		window.dispatchEvent(new Event('offline'));

		expect(removeSpy).toHaveBeenCalledWith('online', expect.any(Function));
		expect(removeSpy).toHaveBeenCalledWith('offline', expect.any(Function));
		expect(get(isOffline)).toBe(false);
	});

	it('is watched for as long as a party subscription lives, and cleanup stops it', () => {
		subscribeToParty('test-party-id');
		window.dispatchEvent(new Event('offline'));
		expect(get(isOffline)).toBe(true);

		cleanup();
		window.dispatchEvent(new Event('online'));
		window.dispatchEvent(new Event('offline'));

		expect(get(isOffline)).toBe(false);
	});

	it('registers the listeners exactly once across repeated subscribeToParty calls', () => {
		const addSpy = vi.spyOn(window, 'addEventListener');

		subscribeToParty('party-a');
		subscribeToParty('party-b');

		expect(addSpy.mock.calls.filter(([type]) => type === 'online')).toHaveLength(1);
		expect(addSpy.mock.calls.filter(([type]) => type === 'offline')).toHaveLength(1);
	});
});

// navigator/window are undefined during SvelteKit's SSR render, so the initial
// value and the listener registration must both be guarded. Force `browser: false`
// (the value $app/environment has on the server) and import the modules fresh.
describe('SSR safety', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	afterEach(() => {
		vi.doUnmock('$app/environment');
		vi.resetModules();
	});

	it('does not throw and defaults isOffline to false when window/navigator are unavailable', async () => {
		vi.doMock('$app/environment', () => ({
			browser: false,
			dev: true,
			building: false,
			version: 'test',
		}));

		const mod = await import('$lib/stores/game-realtime');
		const { isOffline: ssrIsOffline } = await import('$lib/stores/connectivity');

		expect(get(ssrIsOffline)).toBe(false);
		expect(() => mod.subscribeToParty('ssr-test-party')).not.toThrow();
		expect(() => mod.cleanupChannels()).not.toThrow();
		expect(get(ssrIsOffline)).toBe(false);
	});
});
