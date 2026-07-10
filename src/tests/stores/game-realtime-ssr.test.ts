import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';

// game-realtime.ts computes isOffline's initial value from navigator.onLine
// and registers window online/offline listeners — both of which must be
// guarded, since navigator/window are undefined during SvelteKit's SSR
// render. Force `browser: false` (mirroring $app/environment's real value on
// the server) and re-import the module fresh to exercise that path.
describe('game-realtime SSR safety', () => {
	beforeEach(() => {
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

		expect(get(mod.isOffline)).toBe(false);
		expect(() => mod.subscribeToParty('ssr-test-party')).not.toThrow();
		expect(() => mod.cleanupChannels()).not.toThrow();
		expect(get(mod.isOffline)).toBe(false);
	});
});
