import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	isLoading,
	error,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square } from '$lib/types';
import { sessionStorageMock } from '../setup';

// Mock $app/stores
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			params: { code: 'TEST123' },
			url: new URL('http://localhost/party/TEST123'),
			route: { id: '/party/[code]' },
		}),
	};
});

// Mock loadParty and subscribeToParty so onMount doesn't fire real logic
vi.mock('$lib/stores/game', async (importOriginal) => {
	const original = (await importOriginal()) as Record<string, unknown>;
	return {
		...original,
		loadParty: vi.fn().mockResolvedValue(true),
		subscribeToParty: vi.fn().mockReturnValue(() => {}),
	};
});

// Mock storage — must include all exports since user.ts imports from $lib/storage
vi.mock('$lib/storage', async (importOriginal) => {
	const original = (await importOriginal()) as Record<string, unknown>;
	return {
		...original,
		saveRecentParty: vi.fn().mockResolvedValue(undefined),
		hasHostPin: vi.fn().mockResolvedValue(false),
		getHostPin: vi.fn().mockResolvedValue(null),
		setHostPin: vi.fn().mockResolvedValue(undefined),
		getRecentParties: vi.fn().mockResolvedValue([]),
	};
});

import PartyPage from '../../routes/party/[code]/+page.svelte';

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

function createMockSquare(row: number, col: number, overrides: Partial<Square> = {}): Square {
	return {
		id: `sq-${row}-${col}`,
		party_id: 'test-party-id',
		row_num: row,
		col_num: col,
		player_name: null,
		player_name_lower: null,
		claimed_at: null,
		...overrides,
	};
}

function createEmptyGrid(): Square[] {
	const grid: Square[] = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			grid.push(createMockSquare(row, col));
		}
	}
	return grid;
}

function createFullGrid(): Square[] {
	return createEmptyGrid().map((s) => ({
		...s,
		player_name: `Player${s.row_num}${s.col_num}`,
		player_name_lower: `player${s.row_num}${s.col_num}`,
		claimed_at: new Date().toISOString(),
	}));
}

describe('Party Page', () => {
	beforeEach(async () => {
		cleanup();
		await userName.setName('TestUser');
	});

	describe('Loading State', () => {
		it('shows loading state when isLoading is true', () => {
			isLoading.set(true);
			party.set(null);
			render(PartyPage);

			expect(screen.getByText('Loading party...')).toBeInTheDocument();
		});
	});

	describe('Error State', () => {
		it('shows error + "Go Home" when error store set', () => {
			isLoading.set(false);
			error.set('Party not found');
			render(PartyPage);

			expect(screen.getByText('Party not found')).toBeInTheDocument();
			const homeLink = screen.getByRole('link', { name: /Go Home/i });
			expect(homeLink).toHaveAttribute('href', '/');
		});
	});

	describe('No Username Redirect', () => {
		it('redirects to /join?code=X when no userName', async () => {
			const { goto } = await import('$app/navigation');
			await userName.clear();

			isLoading.set(false);
			render(PartyPage);

			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith('/join?code=TEST123');
			});
		});
	});

	describe('Filling Status', () => {
		it('shows filled count banner during filling', () => {
			isLoading.set(false);
			error.set(null);
			const grid = createEmptyGrid();
			// Claim 50 squares
			for (let i = 0; i < 50; i++) {
				grid[i].player_name = 'Someone';
				grid[i].player_name_lower = 'someone';
				grid[i].claimed_at = new Date().toISOString();
			}
			party.set(createMockParty({ status: 'filling' }));
			squares.set(grid);
			scores.set(null);
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.getAllByText(/squares filled/).length).toBeGreaterThan(0);
		});

		it('shows "Ready to lock!" when grid full', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'filling' }));
			squares.set(createFullGrid());
			scores.set(null);
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.getAllByText(/Ready to lock!/).length).toBeGreaterThan(0);
		});
	});

	describe('Active Status', () => {
		it('shows ScoreBoard when status is active', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'active' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: 7,
				q1_col_score: 3,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set({
				party_id: 'test-party-id',
				row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				assigned_at: new Date().toISOString(),
			});
			render(PartyPage);

			// ScoreBoard component renders a scoreboard div
			expect(document.querySelector('.scoreboard')).toBeInTheDocument();
		});

		it('REGRESSION: shows ScoreBoard when status is locked', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'locked' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: null,
				q1_col_score: null,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set({
				party_id: 'test-party-id',
				row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				assigned_at: new Date().toISOString(),
			});
			render(PartyPage);

			expect(document.querySelector('.scoreboard')).toBeInTheDocument();
		});
	});

	describe('Complete Status', () => {
		it('shows "Game complete!" when status is complete', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'complete' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: 7,
				q1_col_score: 3,
				q2_row_score: 14,
				q2_col_score: 10,
				q3_row_score: 21,
				q3_col_score: 17,
				final_row_score: 28,
				final_col_score: 24,
			});
			winners.set([]);
			numbers.set({
				party_id: 'test-party-id',
				row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				assigned_at: new Date().toISOString(),
			});
			render(PartyPage);

			expect(screen.getAllByText(/Game complete!/).length).toBeGreaterThan(0);
		});
	});

	describe('Host Controls', () => {
		it('shows "Host Panel" link when isHost', async () => {
			// Simulate host by setting session storage PIN
			const { hasHostPin } = await import('$lib/storage');
			vi.mocked(hasHostPin).mockResolvedValue(true);
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');

			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'active' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: null,
				q1_col_score: null,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			await waitFor(() => {
				const hostLink = screen.getByRole('link', { name: /Host Panel/i });
				expect(hostLink).toBeInTheDocument();
				expect(hostLink).toHaveAttribute('href', '/party/TEST123/admin');
			});
		});

		it('hides "Host Panel" link when not isHost', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'active' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: null,
				q1_col_score: null,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.queryByRole('link', { name: /Host Panel/i })).not.toBeInTheDocument();
		});
	});

	describe('Team Header', () => {
		it('shows team names in header', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ team_row_name: 'Eagles', team_col_name: 'Chiefs' }));
			squares.set(createEmptyGrid());
			scores.set(null);
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.getByText('Eagles vs Chiefs')).toBeInTheDocument();
		});
	});
});
