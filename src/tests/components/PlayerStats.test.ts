import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PlayerStats from '$lib/components/PlayerStats.svelte';
import { party, squares } from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Square } from '$lib/types';
import { createMockParty, createMockSquare as baseSquare } from '../factories';

function createMockSquare(row: number, col: number, playerName: string | null = null): Square {
	return baseSquare(row, col, {
		player_name: playerName,
		player_name_lower: playerName?.toLowerCase() ?? null,
		claimed_at: playerName ? new Date().toISOString() : null,
	});
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
