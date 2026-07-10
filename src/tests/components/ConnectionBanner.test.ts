import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

interface BannerState {
	status: 'connected' | 'reconnecting' | 'failed';
	attempt: number;
}

// vi.hoisted runs before vi.mock so the store references are initialized in time.
const { mockStore, mockOfflineStore } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted setup, ESM dynamic import not available here
	const { writable } = require('svelte/store');
	return {
		mockStore: writable({ status: 'connected', attempt: 0 }),
		mockOfflineStore: writable(false),
	};
});

vi.mock('$lib/stores/game-realtime', () => ({
	connectionStatus: { subscribe: mockStore.subscribe },
	isOffline: { subscribe: mockOfflineStore.subscribe },
}));

import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';

const setStatus = (state: BannerState) => mockStore.set(state);
const setOffline = (offline: boolean) => mockOfflineStore.set(offline);

describe('ConnectionBanner', () => {
	beforeEach(() => {
		setStatus({ status: 'connected', attempt: 0 });
		setOffline(false);
	});

	afterEach(() => {
		setStatus({ status: 'connected', attempt: 0 });
		setOffline(false);
	});

	it('renders nothing when status is connected', () => {
		const { container } = render(ConnectionBanner);
		expect(container.querySelector('.banner')).toBeNull();
	});

	it('renders the reconnecting banner with attempt count', async () => {
		render(ConnectionBanner);
		setStatus({ status: 'reconnecting', attempt: 2 });
		await tick();

		const banner = document.querySelector('.banner-reconnecting');
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveAttribute('role', 'status');
		expect(banner).toHaveAttribute('aria-live', 'polite');
		expect(banner?.textContent).toMatch(/Reconnecting/);
		expect(banner?.textContent).toMatch(/attempt 2/);
	});

	it('omits the attempt count when attempt is zero', async () => {
		render(ConnectionBanner);
		setStatus({ status: 'reconnecting', attempt: 0 });
		await tick();

		const banner = document.querySelector('.banner-reconnecting');
		expect(banner).toBeInTheDocument();
		expect(banner?.textContent).toMatch(/Reconnecting/);
		expect(banner?.textContent).not.toMatch(/attempt/);
	});

	it('renders the failed banner with refresh button', async () => {
		render(ConnectionBanner);
		setStatus({ status: 'failed', attempt: 5 });
		await tick();

		const banner = document.querySelector('.banner-failed');
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveAttribute('role', 'alert');
		expect(banner).toHaveAttribute('aria-live', 'assertive');
		expect(banner?.textContent).toMatch(/Connection lost/);

		const button = banner?.querySelector('button');
		expect(button).toBeInTheDocument();
		expect(button?.textContent).toMatch(/Refresh/);
	});

	it('clicking refresh calls location.reload', async () => {
		const reloadSpy = vi.fn();
		const originalLocation = window.location;
		// jsdom's location.reload is not configurable, so swap the whole location
		// object for the duration of this test.
		Object.defineProperty(window, 'location', {
			configurable: true,
			value: { ...originalLocation, reload: reloadSpy },
		});

		render(ConnectionBanner);
		setStatus({ status: 'failed', attempt: 5 });
		await tick();

		const button = document.querySelector('.refresh-btn');
		expect(button).toBeInTheDocument();
		(button as HTMLButtonElement).click();
		expect(reloadSpy).toHaveBeenCalledOnce();

		Object.defineProperty(window, 'location', {
			configurable: true,
			value: originalLocation,
		});
	});

	it('renders the offline banner when offline', async () => {
		render(ConnectionBanner);
		setOffline(true);
		await tick();

		const banner = document.querySelector('.banner-offline');
		expect(banner).toBeInTheDocument();
		expect(banner).toHaveAttribute('role', 'alert');
		expect(banner).toHaveAttribute('aria-live', 'assertive');
		expect(banner?.textContent).toMatch(/offline/i);
	});

	it('renders reconnecting copy when the channel is reconnecting and the network is up', async () => {
		render(ConnectionBanner);
		setOffline(false);
		setStatus({ status: 'reconnecting', attempt: 1 });
		await tick();

		expect(document.querySelector('.banner-offline')).toBeNull();
		const banner = document.querySelector('.banner-reconnecting');
		expect(banner).toBeInTheDocument();
		expect(banner?.textContent).toMatch(/Reconnecting/);
	});

	it('offline banner takes precedence when both offline and reconnecting', async () => {
		render(ConnectionBanner);
		setStatus({ status: 'reconnecting', attempt: 3 });
		setOffline(true);
		await tick();

		expect(document.querySelector('.banner-reconnecting')).toBeNull();
		expect(document.querySelector('.banner-failed')).toBeNull();
		const banner = document.querySelector('.banner-offline');
		expect(banner).toBeInTheDocument();
	});

	it('offline banner takes precedence over the failed banner', async () => {
		render(ConnectionBanner);
		setStatus({ status: 'failed', attempt: 5 });
		setOffline(true);
		await tick();

		expect(document.querySelector('.banner-failed')).toBeNull();
		expect(document.querySelector('.banner-offline')).toBeInTheDocument();
	});
});
