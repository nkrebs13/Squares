import { describe, it, expect, beforeEach } from 'vitest';
import { tick } from 'svelte';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import PlayerLegend from '$lib/components/PlayerLegend.svelte';
import { party, squares, selectedPlayerFilter } from '$lib/stores/game';
import { get } from 'svelte/store';
import { getPlayerColor } from '$lib/utils/colors';
import type { Square } from '$lib/types';
import { createMockParty, createMockSquare as baseSquare } from '../factories';

function createMockSquare(row: number, col: number, playerName: string | null = null): Square {
	return baseSquare(row, col, {
		player_name: playerName,
		player_name_lower: playerName?.toLowerCase() ?? null,
		claimed_at: playerName ? new Date().toISOString() : null,
	});
}

describe('PlayerLegend Component', () => {
	beforeEach(() => {
		party.set(null);
		squares.set([]);
		selectedPlayerFilter.set(null);
	});

	it('renders nothing when no players', () => {
		squares.set([
			createMockSquare(0, 0), // unclaimed
		]);
		const { container } = render(PlayerLegend);
		expect(container.innerHTML).toBe('<!---->');
	});

	it('displays "Players" heading', () => {
		squares.set([createMockSquare(0, 0, 'Alice')]);
		render(PlayerLegend);
		expect(screen.getByText('Players')).toBeInTheDocument();
	});

	it('shows player names and counts', () => {
		squares.set([
			createMockSquare(0, 0, 'Alice'),
			createMockSquare(0, 1, 'Alice'),
			createMockSquare(1, 0, 'Bob'),
		]);
		render(PlayerLegend);

		expect(screen.getByText('Alice')).toBeInTheDocument();
		expect(screen.getByText('2')).toBeInTheDocument();
		expect(screen.getByText('Bob')).toBeInTheDocument();
		expect(screen.getByText('1')).toBeInTheDocument();
	});

	it('shows available count when filling', () => {
		party.set(createMockParty({ status: 'filling' }));
		squares.set([
			createMockSquare(0, 0, 'Alice'),
			createMockSquare(0, 1), // unclaimed
			createMockSquare(1, 0), // unclaimed
		]);
		render(PlayerLegend);

		expect(screen.getByText('2 squares available')).toBeInTheDocument();
	});

	it('says "1 square available" for the last square', () => {
		party.set(createMockParty({ status: 'filling' }));
		squares.set([createMockSquare(0, 0, 'Alice'), createMockSquare(0, 1)]);
		render(PlayerLegend);

		expect(screen.getByText('1 square available')).toBeInTheDocument();
	});

	it('hides available count when not filling', () => {
		party.set(createMockParty({ status: 'active' }));
		squares.set([
			createMockSquare(0, 0, 'Alice'),
			createMockSquare(0, 1), // unclaimed
		]);
		render(PlayerLegend);

		expect(screen.queryByText(/squares available/)).not.toBeInTheDocument();
	});

	it('clicking player pill toggles filter', async () => {
		squares.set([createMockSquare(0, 0, 'Alice')]);
		render(PlayerLegend);

		const user = userEvent.setup();
		await user.click(screen.getByText('Alice'));

		expect(get(selectedPlayerFilter)).toBe('alice');
	});

	it('clicking active filter clears it', async () => {
		squares.set([createMockSquare(0, 0, 'Alice')]);
		selectedPlayerFilter.set('alice');
		render(PlayerLegend);

		const user = userEvent.setup();
		await user.click(screen.getByText('Alice'));

		expect(get(selectedPlayerFilter)).toBeNull();
	});

	it('colors the pill dot from the normalized (lowercase) player name, not the raw casing (Bug 2 regression)', () => {
		squares.set([createMockSquare(0, 0, 'JOHN')]);
		render(PlayerLegend);

		const dot = document.querySelector('.player-dot') as HTMLElement;
		expect(dot).toBeTruthy();

		// The pill must hash on normalizePlayerName('JOHN') === 'john', not the
		// raw stored casing — otherwise "JOHN" and "John" squares for the same
		// logical player would render different swatch colors.
		const expectedColor = getPlayerColor('john');
		expect(dot.getAttribute('style')).toBe(`background: ${expectedColor.text};`);
	});
});

describe('PlayerLegend collapsible (mobile, under the grid)', () => {
	const owners = (n: number) =>
		Array.from({ length: n }, (_, i) => createMockSquare(0, i, `Player${i}`));
	const toggle = () => screen.getByRole('button', { name: /Players \(/ });

	beforeEach(() => {
		party.set(null);
		squares.set([]);
		selectedPlayerFilter.set(null);
	});

	it('starts open for four players or fewer, with the tap hint', () => {
		squares.set(owners(4));
		render(PlayerLegend, { props: { collapsible: true } });
		expect(toggle()).toHaveAttribute('aria-expanded', 'true');
		expect(screen.getByText('tap to highlight')).toBeInTheDocument();
		expect(screen.getByText('Player0')).toBeInTheDocument();
	});

	it('starts closed for more than four players', () => {
		squares.set(owners(5));
		render(PlayerLegend, { props: { collapsible: true } });
		expect(toggle()).toHaveAttribute('aria-expanded', 'false');
		expect(screen.queryByText('Player0')).not.toBeInTheDocument();
	});

	it('toggles open and closed and drops the hint once used', async () => {
		squares.set(owners(5));
		render(PlayerLegend, { props: { collapsible: true } });
		const user = userEvent.setup();

		await user.click(toggle());
		expect(toggle()).toHaveAttribute('aria-expanded', 'true');
		expect(screen.queryByText('tap to highlight')).not.toBeInTheDocument();

		await user.click(toggle());
		expect(toggle()).toHaveAttribute('aria-expanded', 'false');
	});

	it('stays closed after the user collapses it, when the roster changes', async () => {
		squares.set(owners(3));
		render(PlayerLegend, { props: { collapsible: true } });
		const user = userEvent.setup();

		await user.click(toggle());
		expect(toggle()).toHaveAttribute('aria-expanded', 'false');

		squares.set(owners(4));
		await tick();
		expect(toggle()).toHaveAttribute('aria-expanded', 'false');
	});

	it('stays open once a pill is used, when the roster grows past four', async () => {
		squares.set(owners(4));
		render(PlayerLegend, { props: { collapsible: true } });
		await userEvent.setup().click(screen.getByText('Player0'));

		squares.set(owners(5));
		await tick();
		expect(toggle()).toHaveAttribute('aria-expanded', 'true');
	});

	it('marks the toggle while a player filter is active', () => {
		squares.set(owners(5));
		selectedPlayerFilter.set('player1');
		render(PlayerLegend, { props: { collapsible: true } });
		expect(screen.getByText('filtering')).toBeInTheDocument();
	});
});
