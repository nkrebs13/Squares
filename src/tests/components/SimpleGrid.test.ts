import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import SimpleGrid from '$lib/components/SimpleGrid.svelte';
import {
	squares,
	numbers,
	party,
	winners,
	pendingOperations,
	selectedPlayerFilter,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square as SquareType, Numbers, Winner } from '$lib/types';

// Helper to create mock squares for a full 10x10 grid
function createMockSquares(overrides: Partial<SquareType>[] = []): SquareType[] {
	const result: SquareType[] = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			const override = overrides.find((o) => o.row_num === row && o.col_num === col);
			result.push({
				id: `sq-${row}-${col}`,
				party_id: 'test-party',
				row_num: row,
				col_num: col,
				player_name: null,
				player_name_lower: null,
				claimed_at: null,
				...override,
			});
		}
	}
	return result;
}

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party',
		code: 'ABC123',
		host_pin: '1234',
		host_name_lower: null,
		square_price: 5,
		split_q1: 25,
		split_q2: 25,
		split_q3: 25,
		split_final: 25,
		status: 'filling',
		team_row_name: 'Seahawks',
		team_col_name: 'Patriots',
		team_row_color: '#69BE28',
		team_col_color: '#C60C30',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 86400000).toISOString(),
		game_id: null,
		home_team_is_row: null,
		...overrides,
	};
}

function createMockNumbers(): Numbers {
	return {
		party_id: 'test-party',
		row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		assigned_at: new Date().toISOString(),
	};
}

function setupStores(
	opts: {
		partyOverrides?: Partial<Party>;
		squareOverrides?: Partial<SquareType>[];
		withNumbers?: boolean;
		withUser?: string;
		withWinners?: Winner[];
	} = {}
) {
	const mockParty = createMockParty(opts.partyOverrides);
	party.set(mockParty);
	squares.set(createMockSquares(opts.squareOverrides));
	if (opts.withNumbers) {
		numbers.set(createMockNumbers());
	} else {
		numbers.set(null);
	}
	winners.set(opts.withWinners || []);
	pendingOperations.set(new Map());
	selectedPlayerFilter.set(null);
	if (opts.withUser) {
		userName.setName(opts.withUser);
	}
}

describe('SimpleGrid Component', () => {
	beforeEach(async () => {
		vi.clearAllMocks();
		party.set(null);
		squares.set([]);
		numbers.set(null);
		winners.set([]);
		pendingOperations.set(new Map());
		selectedPlayerFilter.set(null);
		await userName.clear();
	});

	describe('Grid Rendering', () => {
		it('renders 100 square buttons when data is loaded', () => {
			setupStores({ withNumbers: true, withUser: 'TestUser' });
			render(SimpleGrid);

			const buttons = screen.getAllByRole('button');
			// 100 grid squares + zoom/player toggles potentially
			const squareButtons = buttons.filter(
				(b) => b.classList.contains('square-empty') || b.classList.contains('square-claimed')
			);
			expect(squareButtons.length).toBe(100);
		});

		it('renders column headers with numbers', () => {
			setupStores({ withNumbers: true });
			render(SimpleGrid);

			const headers = document.querySelectorAll('.col-header');
			expect(headers).toHaveLength(10);
		});

		it('renders row headers with numbers', () => {
			setupStores({ withNumbers: true });
			render(SimpleGrid);

			const headers = document.querySelectorAll('.row-header');
			expect(headers).toHaveLength(10);
		});

		it('renders question marks when numbers are not assigned', () => {
			setupStores();
			render(SimpleGrid);

			const headers = document.querySelectorAll('.col-header');
			if (headers.length > 0) {
				expect(headers[0].textContent?.trim()).toBe('?');
			}
		});

		it('renders team labels', () => {
			setupStores({ withNumbers: true });
			render(SimpleGrid);

			expect(screen.getByText('Patriots')).toBeInTheDocument();
			expect(screen.getByText('Seahawks')).toBeInTheDocument();
		});
	});

	describe('Stats Bar', () => {
		it('shows square count when user is set', () => {
			setupStores({
				withUser: 'TestUser',
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'TestUser', player_name_lower: 'testuser' },
					{ row_num: 0, col_num: 1, player_name: 'TestUser', player_name_lower: 'testuser' },
				],
			});
			render(SimpleGrid);

			expect(screen.getByText('Your squares:')).toBeInTheDocument();
		});

		it('shows amount owed when square price is set', () => {
			setupStores({
				withUser: 'TestUser',
				partyOverrides: { square_price: 10 },
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'TestUser', player_name_lower: 'testuser' },
				],
			});
			render(SimpleGrid);

			expect(screen.getByText('You owe:')).toBeInTheDocument();
		});

		it('does not show stats bar when no user', () => {
			setupStores();
			render(SimpleGrid);

			expect(screen.queryByText('Your squares:')).not.toBeInTheDocument();
		});
	});

	describe('Legend', () => {
		it('renders Available legend item', () => {
			setupStores();
			render(SimpleGrid);

			expect(screen.getByText('Available')).toBeInTheDocument();
		});

		it('renders Yours legend item when user is set', () => {
			setupStores({ withUser: 'TestUser' });
			render(SimpleGrid);

			expect(screen.getByText('Yours')).toBeInTheDocument();
		});

		it('does not render Yours legend item when no user', () => {
			setupStores();
			render(SimpleGrid);

			expect(screen.queryByText('Yours')).not.toBeInTheDocument();
		});

		it('renders Winner legend item', () => {
			setupStores();
			render(SimpleGrid);

			expect(screen.getByText('Winner')).toBeInTheDocument();
		});
	});

	describe('Zoom Control', () => {
		it('shows zoom button when fitCellSize < ZOOMED_CELL_SIZE', () => {
			setupStores({ withNumbers: true });
			// Render in a narrow container so fit cell size would be < 64
			render(SimpleGrid);

			// The zoom button shows based on container width measurements
			// Since jsdom doesn't compute layout, fitCellSize defaults to MIN_CELL_SIZE_MOBILE (28)
			// which is < ZOOMED_CELL_SIZE (64), so zoom should appear
			const zoomBtn = screen.queryByText('Zoom');
			expect(zoomBtn).toBeInTheDocument();
		});

		it('toggles zoom state when clicked', async () => {
			setupStores({ withNumbers: true });
			render(SimpleGrid);

			const zoomBtn = screen.getByText('Zoom');
			await fireEvent.click(zoomBtn);

			// After zooming, button should show "Fit"
			expect(screen.getByText('Fit')).toBeInTheDocument();
		});

		it('toggles back to fit when Fit is clicked', async () => {
			setupStores({ withNumbers: true });
			render(SimpleGrid);

			// Click Zoom
			await fireEvent.click(screen.getByText('Zoom'));
			expect(screen.getByText('Fit')).toBeInTheDocument();

			// Click Fit
			await fireEvent.click(screen.getByText('Fit'));
			expect(screen.getByText('Zoom')).toBeInTheDocument();
		});
	});

	describe('Mouse Drag Selection', () => {
		it('starts selection on pointer down for mouse', async () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });
			render(SimpleGrid);

			const emptySquares = screen
				.getAllByRole('button')
				.filter((b) => b.classList.contains('square-empty'));

			// Mouse pointer down starts drag
			await fireEvent.pointerDown(emptySquares[0], {
				button: 0,
				pointerType: 'mouse',
			});

			// The selection indicator shouldn't appear until drag moves
			// But isDragging should be set
			// We verify by checking class changes
			expect(emptySquares[0]).toHaveAttribute('aria-selected', 'true');
		});

		it('does not start drag on right-click', async () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });
			render(SimpleGrid);

			const emptySquares = screen
				.getAllByRole('button')
				.filter((b) => b.classList.contains('square-empty'));

			await fireEvent.pointerDown(emptySquares[0], {
				button: 2,
				pointerType: 'mouse',
			});

			expect(emptySquares[0]).not.toHaveAttribute('aria-selected', 'true');
		});

		it('does not start drag when party is not filling', async () => {
			setupStores({
				withUser: 'TestUser',
				withNumbers: true,
				partyOverrides: { status: 'locked' },
			});
			render(SimpleGrid);

			const buttons = screen
				.getAllByRole('button')
				.filter((b) => b.classList.contains('square-empty'));

			if (buttons.length > 0) {
				await fireEvent.pointerDown(buttons[0], {
					button: 0,
					pointerType: 'mouse',
				});

				expect(buttons[0]).not.toHaveAttribute('aria-selected', 'true');
			}
		});
	});

	describe('Touch Tap Behavior', () => {
		it('does not start drag on touch pointer down', async () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });
			render(SimpleGrid);

			const emptySquares = screen
				.getAllByRole('button')
				.filter((b) => b.classList.contains('square-empty'));

			await fireEvent.pointerDown(emptySquares[0], {
				button: 0,
				pointerType: 'touch',
			});

			// Touch should NOT start drag selection
			expect(emptySquares[0]).not.toHaveAttribute('aria-selected', 'true');
		});
	});

	describe('Global Pointer Event Cleanup', () => {
		it('clears drag state on global pointerup', async () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });
			render(SimpleGrid);

			const emptySquares = screen
				.getAllByRole('button')
				.filter((b) => b.classList.contains('square-empty'));

			// Start a drag
			await fireEvent.pointerDown(emptySquares[0], {
				button: 0,
				pointerType: 'mouse',
			});

			// Global pointer up should clean up
			await fireEvent(window, new PointerEvent('pointerup'));

			// Selection should be cleared (batch claimed)
			expect(emptySquares[0]).not.toHaveAttribute('aria-selected', 'true');
		});

		it('clears all state on global pointercancel', async () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });
			render(SimpleGrid);

			const emptySquares = screen
				.getAllByRole('button')
				.filter((b) => b.classList.contains('square-empty'));

			// Start a drag
			await fireEvent.pointerDown(emptySquares[0], {
				button: 0,
				pointerType: 'mouse',
			});

			// Global pointer cancel should clear everything
			await fireEvent(window, new PointerEvent('pointercancel'));

			expect(emptySquares[0]).not.toHaveAttribute('aria-selected', 'true');
		});
	});

	describe('Player Filter', () => {
		it('shows player list when players exist', () => {
			setupStores({
				withNumbers: true,
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'Alice', player_name_lower: 'alice' },
					{ row_num: 0, col_num: 1, player_name: 'Bob', player_name_lower: 'bob' },
				],
			});
			render(SimpleGrid);

			// The players section should be visible
			expect(screen.getByText(/Players \(2\)/)).toBeInTheDocument();
		});

		it('shows player names with square counts', () => {
			setupStores({
				withNumbers: true,
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'Alice', player_name_lower: 'alice' },
					{ row_num: 0, col_num: 1, player_name: 'Alice', player_name_lower: 'alice' },
					{ row_num: 1, col_num: 0, player_name: 'Bob', player_name_lower: 'bob' },
				],
			});
			render(SimpleGrid);

			// Player names should appear (auto-expanded for <= 4 players)
			expect(screen.getByText('Alice')).toBeInTheDocument();
			expect(screen.getByText('Bob')).toBeInTheDocument();
			// Square counts are inside player-pill buttons with .player-count class
			const playerCounts = document.querySelectorAll('.player-count');
			const counts = Array.from(playerCounts).map((el) => el.textContent);
			expect(counts).toContain('2');
			expect(counts).toContain('1');
		});

		it('applies highlighted class to matching squares', () => {
			setupStores({
				withNumbers: true,
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'Alice', player_name_lower: 'alice' },
					{ row_num: 0, col_num: 1, player_name: 'Bob', player_name_lower: 'bob' },
				],
			});

			selectedPlayerFilter.set('alice');
			render(SimpleGrid);

			const wrappers = document.querySelectorAll('.square-wrapper');
			const highlighted = document.querySelectorAll('.square-wrapper.highlighted');
			const dimmed = document.querySelectorAll('.square-wrapper.dimmed');

			expect(highlighted.length).toBe(1);
			expect(dimmed.length).toBe(wrappers.length - 1);
		});

		it('toggles player filter on pill click', async () => {
			setupStores({
				withNumbers: true,
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'Alice', player_name_lower: 'alice' },
					{ row_num: 0, col_num: 1, player_name: 'Bob', player_name_lower: 'bob' },
				],
			});
			render(SimpleGrid);

			const alicePill = screen.getByText('Alice').closest('button');
			expect(alicePill).toBeInTheDocument();
			if (alicePill) await fireEvent.click(alicePill);

			expect(document.querySelectorAll('.square-wrapper.highlighted').length).toBe(1);

			// Click again to deselect
			if (alicePill) await fireEvent.click(alicePill);
			expect(document.querySelectorAll('.square-wrapper.highlighted').length).toBe(0);
		});

		it('shows available squares count during filling', () => {
			setupStores({
				withNumbers: true,
				partyOverrides: { status: 'filling' },
				squareOverrides: [
					{ row_num: 0, col_num: 0, player_name: 'Alice', player_name_lower: 'alice' },
				],
			});
			render(SimpleGrid);

			expect(screen.getByText('99 squares available')).toBeInTheDocument();
		});
	});

	describe('Selection Indicator', () => {
		it('does not show selection indicator when not dragging', () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });
			render(SimpleGrid);

			expect(document.querySelector('.selection-indicator')).not.toBeInTheDocument();
		});
	});

	describe('Empty Grid', () => {
		it('renders grid structure even without squares data', () => {
			party.set(createMockParty());
			squares.set([]);
			numbers.set(null);
			render(SimpleGrid);

			expect(document.querySelector('.grid-wrapper')).toBeInTheDocument();
		});
	});

	describe('Pending Operations', () => {
		it('marks squares as pending when in pendingOperations', () => {
			setupStores({ withUser: 'TestUser', withNumbers: true });

			const ops = new Map();
			ops.set('0-0', {
				id: 'op-1',
				type: 'claim',
				row: 0,
				col: 0,
				timestamp: Date.now(),
				status: 'pending',
				originalState: { player_name: null, player_name_lower: null, claimed_at: null },
			});
			pendingOperations.set(ops);

			render(SimpleGrid);

			const pendingSquares = document.querySelectorAll('.square-pending');
			expect(pendingSquares.length).toBe(1);
		});
	});
});
