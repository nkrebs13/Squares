import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

const { mockPlayerSummary, mockSelectedFilter } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { writable } = require('svelte/store');
	return {
		mockPlayerSummary: writable([]),
		mockSelectedFilter: writable(null),
	};
});

vi.mock('$lib/stores/game', () => ({
	playerSummary: { subscribe: mockPlayerSummary.subscribe },
	selectedPlayerFilter: { subscribe: mockSelectedFilter.subscribe },
}));

vi.mock('$lib/components/PlayerLegend.svelte', () => ({
	default: vi.fn(),
}));

import MobilePlayerFilter from '$lib/components/MobilePlayerFilter.svelte';

const makePlayers = (n: number) =>
	Array.from({ length: n }, (_, i) => ({ name: `Player${i}`, count: 1, color: '#fff' }));

describe('MobilePlayerFilter', () => {
	it('renders nothing when playerSummary is empty', () => {
		mockPlayerSummary.set([]);
		const { container } = render(MobilePlayerFilter);
		expect(container.querySelector('.players-section')).toBeNull();
	});

	it('renders the section when players exist', async () => {
		mockPlayerSummary.set(makePlayers(2));
		const { container } = render(MobilePlayerFilter);
		await tick();
		expect(container.querySelector('.players-section')).toBeTruthy();
	});

	it('auto-expands when player count is 4 or fewer', async () => {
		mockPlayerSummary.set(makePlayers(4));
		const { container } = render(MobilePlayerFilter);
		await tick();
		const toggle = container.querySelector('.players-toggle') as HTMLButtonElement;
		expect(toggle?.getAttribute('aria-expanded')).toBe('true');
	});

	it('does not auto-expand when player count exceeds 4', async () => {
		mockPlayerSummary.set(makePlayers(5));
		const { container } = render(MobilePlayerFilter);
		await tick();
		const toggle = container.querySelector('.players-toggle') as HTMLButtonElement;
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
	});

	it('toggles expand state when toggle button is clicked', async () => {
		mockPlayerSummary.set(makePlayers(5));
		const { container } = render(MobilePlayerFilter);
		await tick();
		const toggle = container.querySelector('.players-toggle') as HTMLButtonElement;
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
		await fireEvent.click(toggle);
		expect(toggle?.getAttribute('aria-expanded')).toBe('true');
		await fireEvent.click(toggle);
		expect(toggle?.getAttribute('aria-expanded')).toBe('false');
	});

	it('shows tap-to-highlight hint badge before interaction when auto-expanded', async () => {
		mockPlayerSummary.set(makePlayers(3));
		const { container } = render(MobilePlayerFilter);
		await tick();
		expect(container.querySelector('.hint-badge')).toBeTruthy();
	});

	it('shows filtering badge when a player filter is active', async () => {
		mockPlayerSummary.set(makePlayers(5));
		mockSelectedFilter.set('Player1');
		const { container } = render(MobilePlayerFilter);
		await tick();
		expect(container.querySelector('.filter-badge')).toBeTruthy();
		mockSelectedFilter.set(null);
	});

	it('hides hint badge after toggle interaction', async () => {
		mockPlayerSummary.set(makePlayers(5));
		const { container } = render(MobilePlayerFilter);
		await tick();
		const toggle = container.querySelector('.players-toggle') as HTMLButtonElement;
		await fireEvent.click(toggle);
		expect(container.querySelector('.hint-badge')).toBeNull();
	});
});
