import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PlayerStats from '$lib/components/PlayerStats.svelte';
import { party, squares } from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square } from '$lib/types';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
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

describe('PlayerStats Component', () => {
	beforeEach(async () => {
		party.set(null);
		squares.set([]);
		await userName.clear();
	});

	it('renders nothing when no userName', () => {
		party.set(createMockParty());
		const { container } = render(PlayerStats);
		expect(container.innerHTML).toBe('<!---->');
	});

	it('displays "Playing as" with user name', async () => {
		await userName.setName('Alice');
		party.set(createMockParty());
		squares.set([]);
		render(PlayerStats);

		expect(screen.getByText('Playing as')).toBeInTheDocument();
		expect(screen.getByText('Alice')).toBeInTheDocument();
	});

	it('displays square count', async () => {
		await userName.setName('Alice');
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, 'Alice'),
			createMockSquare(0, 1, 'Alice'),
			createMockSquare(1, 0, 'Bob'),
		]);
		render(PlayerStats);

		expect(screen.getByText('Squares owned')).toBeInTheDocument();
		expect(screen.getByText('2')).toBeInTheDocument();
	});

	it('displays amount owed when party has price', async () => {
		await userName.setName('Alice');
		party.set(createMockParty({ square_price: 5 }));
		squares.set([createMockSquare(0, 0, 'Alice'), createMockSquare(0, 1, 'Alice')]);
		render(PlayerStats);

		expect(screen.getByText('Amount owed')).toBeInTheDocument();
		expect(screen.getByText('$10')).toBeInTheDocument();
	});

	it('hides amount owed when price is 0', async () => {
		await userName.setName('Alice');
		party.set(createMockParty({ square_price: 0 }));
		squares.set([createMockSquare(0, 0, 'Alice')]);
		render(PlayerStats);

		expect(screen.queryByText('Amount owed')).not.toBeInTheDocument();
	});
});
