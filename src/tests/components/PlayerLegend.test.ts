import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import PlayerLegend from '$lib/components/PlayerLegend.svelte';
import { party, squares, selectedPlayerFilter } from '$lib/stores/game';
import { get } from 'svelte/store';
import { getPlayerColor } from '$lib/utils/colors';
import type { Party, Square } from '$lib/types';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
		event_name: 'Test Football Squares',
		kickoff_at: null,
		square_price: 10,
		split_q1: 25,
		split_q2: 25,
		split_q3: 25,
		split_final: 25,
		status: 'filling',
		team_row_name: 'Eagles',
		team_col_name: 'Chiefs',
		team_row_color: '#004C54',
		team_col_color: '#E31837',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		game_id: null,
		home_team_is_row: null,
		...overrides,
	};
}

function createMockSquare(row: number, col: number, playerName: string | null = null): Square {
	return {
		id: `sq-${row}-${col}`,
		party_id: 'test-party-id',
		row_num: row,
		col_num: col,
		player_name: playerName,
		player_name_lower: playerName?.toLowerCase() ?? null,
		claimed_at: playerName ? new Date().toISOString() : null,
	};
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
