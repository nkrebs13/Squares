import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	gameHomeIsRow,
	liveScores,
	isLoading,
	error,
	gridState,
	filledCount,
	isGridFull,
	mySquares,
	mySquareCount,
	amountOwed,
	playerSummary,
	availableCount,
	pendingOperations,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import {
	createEmptyGrid,
	createMockGameScores,
	createMockNumbers,
	createMockParty,
	createMockScores,
	createMockWinner,
} from '../factories';

describe('Game Store', () => {
	beforeEach(() => {
		// Reset all stores to initial state
		cleanup();
		userName.setName('TestUser');
	});

	describe('Derived Stores', () => {
		describe('gridState', () => {
			it('returns null when party is null', () => {
				expect(get(gridState)).toBeNull();
			});

			it('returns combined state when party is set', () => {
				const mockParty = createMockParty();
				const grid = createEmptyGrid();
				const mockNumbers = createMockNumbers();
				const mockScores = createMockScores();
				const mockWinners = [createMockWinner()];

				party.set(mockParty);
				squares.set(grid);
				numbers.set(mockNumbers);
				scores.set(mockScores);
				winners.set(mockWinners);

				const state = get(gridState);
				expect(state).not.toBeNull();
				expect(state?.party).toEqual(mockParty);
				expect(state?.squares).toHaveLength(100);
				expect(state?.numbers).toEqual(mockNumbers);
				expect(state?.scores).toEqual(mockScores);
				expect(state?.winners).toHaveLength(1);
			});
		});

		describe('filledCount', () => {
			it('returns 0 for empty grid', () => {
				squares.set(createEmptyGrid());
				expect(get(filledCount)).toBe(0);
			});

			it('counts claimed squares correctly', () => {
				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				grid[1].player_name = 'Bob';
				grid[2].player_name = 'Charlie';
				squares.set(grid);

				expect(get(filledCount)).toBe(3);
			});

			it('returns 100 for full grid', () => {
				const grid = createEmptyGrid().map((s) => ({
					...s,
					player_name: 'Player',
				}));
				squares.set(grid);

				expect(get(filledCount)).toBe(100);
			});
		});

		describe('isGridFull', () => {
			it('returns false for empty grid', () => {
				squares.set(createEmptyGrid());
				expect(get(isGridFull)).toBe(false);
			});

			it('returns false for partially filled grid', () => {
				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				squares.set(grid);

				expect(get(isGridFull)).toBe(false);
			});

			it('returns true for full grid', () => {
				const grid = createEmptyGrid().map((s) => ({
					...s,
					player_name: 'Player',
				}));
				squares.set(grid);

				expect(get(isGridFull)).toBe(true);
			});
		});

		describe('mySquares', () => {
			it('returns empty array when no userName', async () => {
				await userName.clear();
				squares.set(createEmptyGrid());

				expect(get(mySquares)).toEqual([]);
			});

			it('returns only squares belonging to current user', async () => {
				await userName.setName('Alice');

				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				grid[0].player_name_lower = 'alice';
				grid[1].player_name = 'Bob';
				grid[1].player_name_lower = 'bob';
				grid[2].player_name = 'Alice';
				grid[2].player_name_lower = 'alice';
				squares.set(grid);

				const mySquaresValue = get(mySquares);
				expect(mySquaresValue).toHaveLength(2);
				expect(mySquaresValue.every((s) => s.player_name_lower === 'alice')).toBe(true);
			});

			it('is case insensitive', async () => {
				await userName.setName('ALICE');

				const grid = createEmptyGrid();
				grid[0].player_name = 'alice';
				grid[0].player_name_lower = 'alice';
				squares.set(grid);

				expect(get(mySquares)).toHaveLength(1);
			});
		});

		describe('mySquareCount', () => {
			it('returns count of user squares', async () => {
				await userName.setName('Alice');

				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				grid[0].player_name_lower = 'alice';
				grid[1].player_name = 'Alice';
				grid[1].player_name_lower = 'alice';
				grid[2].player_name = 'Alice';
				grid[2].player_name_lower = 'alice';
				squares.set(grid);

				expect(get(mySquareCount)).toBe(3);
			});
		});

		describe('amountOwed', () => {
			it('returns 0 when no party', async () => {
				await userName.setName('Alice');
				party.set(null);
				expect(get(amountOwed)).toBe(0);
			});

			it('calculates amount correctly', async () => {
				await userName.setName('Alice');
				party.set(createMockParty({ square_price: 5 }));

				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				grid[0].player_name_lower = 'alice';
				grid[1].player_name = 'Alice';
				grid[1].player_name_lower = 'alice';
				squares.set(grid);

				// 2 squares * $5 = $10
				expect(get(amountOwed)).toBe(10);
			});
		});

		describe('playerSummary', () => {
			it('returns empty array for empty grid', () => {
				squares.set(createEmptyGrid());
				expect(get(playerSummary)).toEqual([]);
			});

			it('groups players and counts correctly', () => {
				const grid = createEmptyGrid();
				// Alice has 3 squares
				grid[0].player_name = 'Alice';
				grid[0].player_name_lower = 'alice';
				grid[1].player_name = 'Alice';
				grid[1].player_name_lower = 'alice';
				grid[2].player_name = 'Alice';
				grid[2].player_name_lower = 'alice';
				// Bob has 2 squares
				grid[3].player_name = 'Bob';
				grid[3].player_name_lower = 'bob';
				grid[4].player_name = 'Bob';
				grid[4].player_name_lower = 'bob';
				squares.set(grid);

				const summary = get(playerSummary);
				expect(summary).toHaveLength(2);

				// Should be sorted by count descending
				expect(summary[0].name).toBe('Alice');
				expect(summary[0].count).toBe(3);
				expect(summary[1].name).toBe('Bob');
				expect(summary[1].count).toBe(2);
			});

			it('handles case variations correctly', () => {
				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				grid[0].player_name_lower = 'alice';
				grid[1].player_name = 'ALICE';
				grid[1].player_name_lower = 'alice';
				squares.set(grid);

				const summary = get(playerSummary);
				expect(summary).toHaveLength(1);
				expect(summary[0].count).toBe(2);
			});
		});

		describe('availableCount', () => {
			it('returns 100 for empty grid', () => {
				squares.set(createEmptyGrid());
				expect(get(availableCount)).toBe(100);
			});

			it('returns correct count after claims', () => {
				const grid = createEmptyGrid();
				grid[0].player_name = 'Alice';
				grid[1].player_name = 'Bob';
				squares.set(grid);

				expect(get(availableCount)).toBe(98);
			});

			it('returns 0 for full grid', () => {
				const grid = createEmptyGrid().map((s) => ({
					...s,
					player_name: 'Player',
				}));
				squares.set(grid);

				expect(get(availableCount)).toBe(0);
			});
		});
	});

	describe('liveScores derived store', () => {
		it('returns null when gameScores is null', () => {
			party.set(createMockParty({ game_id: 'test-game-id', home_team_is_row: true }));
			gameScores.set(null);
			expect(get(liveScores)).toBeNull();
		});

		it('returns null when there is no live game', () => {
			gameScores.set(null);
			expect(get(liveScores)).toBeNull();
		});

		it('maps home to row when home_team_is_row is true', () => {
			party.set(createMockParty({ game_id: 'test-game-id', home_team_is_row: true }));
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 7,
					game_clock: '5:30',
					game_quarter: 2,
					game_status: 'in_progress',
				})
			);

			expect(get(liveScores)).toMatchObject({
				rowScore: 14,
				colScore: 7,
				clock: '5:30',
				quarter: 2,
				status: 'in_progress',
			});
		});

		it('maps away to row when the home team is the column team', () => {
			// The server worked out that the game's home team is the party's column team.
			gameHomeIsRow.set(false);
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 7,
				})
			);

			expect(get(liveScores)).toMatchObject({ rowScore: 7, colScore: 14 });
		});
	});

	describe('cleanup function', () => {
		it('resets all stores to initial state', () => {
			// Set up some state
			party.set(createMockParty());
			squares.set(createEmptyGrid());
			numbers.set(createMockNumbers());
			scores.set(createMockScores());
			winners.set([createMockWinner()]);
			gameScores.set(createMockGameScores());
			error.set('Some error');
			isLoading.set(false);
			gameHomeIsRow.set(false);
			pendingOperations.update((ops) => {
				const newOps = new Map(ops);
				newOps.set('0-0', {
					clientId: 'test-client',
					origin: 'local',
					type: 'claim',
					row: 0,
					col: 0,
					timestamp: Date.now(),
					originalState: {
						player_name: null,
						player_name_lower: null,
						claimed_at: null,
					},
				});
				return newOps;
			});

			// Run cleanup
			cleanup();

			// Verify all stores are reset
			expect(get(party)).toBeNull();
			expect(get(squares)).toEqual([]);
			expect(get(numbers)).toBeNull();
			expect(get(scores)).toBeNull();
			expect(get(winners)).toEqual([]);
			expect(get(gameScores)).toBeNull();
			expect(get(isLoading)).toBe(true);
			expect(get(gameHomeIsRow)).toBe(true);
			expect(get(error)).toBeNull();
			expect(get(pendingOperations).size).toBe(0);
		});
	});
});
