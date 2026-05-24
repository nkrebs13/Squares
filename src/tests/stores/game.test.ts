import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
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
	selectedPlayerFilter,
	pendingOperations,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square, Numbers, Scores, Winner, GameScoresRow } from '$lib/types';

// Helpers to create mock data
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

function createMockSquare(row: number, col: number, overrides: Partial<Square> = {}): Square {
	return {
		id: `square-${row}-${col}`,
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

function createMockNumbers(): Numbers {
	return {
		party_id: 'test-party-id',
		row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
		assigned_at: new Date().toISOString(),
	};
}

function createMockScores(overrides: Partial<Scores> = {}): Scores {
	return {
		party_id: 'test-party-id',
		q1_row_score: null,
		q1_col_score: null,
		q2_row_score: null,
		q2_col_score: null,
		q3_row_score: null,
		q3_col_score: null,
		final_row_score: null,
		final_col_score: null,
		...overrides,
	};
}

function createMockGameScores(overrides: Partial<GameScoresRow> = {}): GameScoresRow {
	return {
		game_id: 'test-game-id',
		sport: 'nfl',
		home_team_abbrev: 'PHI',
		away_team_abbrev: 'KC',
		home_team_name: 'Eagles',
		away_team_name: 'Chiefs',
		home_score: 0,
		away_score: 0,
		game_clock: '',
		game_quarter: 0,
		game_status: 'pregame',
		q1_home: null,
		q1_away: null,
		q2_home: null,
		q2_away: null,
		q3_home: null,
		q3_away: null,
		q4_home: null,
		q4_away: null,
		final_home: null,
		final_away: null,
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

function createMockWinner(overrides: Partial<Winner> = {}): Winner {
	return {
		id: 'test-winner-id',
		party_id: 'test-party-id',
		quarter: 'q1',
		winning_row: 3,
		winning_col: 7,
		player_name: 'John Doe',
		amount: 250,
		created_at: new Date().toISOString(),
		...overrides,
	};
}

describe('Game Store', () => {
	beforeEach(() => {
		// Reset all stores to initial state
		cleanup();
		userName.setName('TestUser');
	});

	describe('Core Stores', () => {
		describe('party store', () => {
			it('initializes as null', () => {
				expect(get(party)).toBeNull();
			});

			it('can be set to a party', () => {
				const mockParty = createMockParty();
				party.set(mockParty);
				expect(get(party)).toEqual(mockParty);
			});

			it('can be updated', () => {
				party.set(createMockParty({ status: 'filling' }));
				party.update((p) => (p ? { ...p, status: 'active' } : null));
				expect(get(party)?.status).toBe('active');
			});
		});

		describe('squares store', () => {
			it('initializes as empty array', () => {
				expect(get(squares)).toEqual([]);
			});

			it('can be set to a grid', () => {
				const grid = createEmptyGrid();
				squares.set(grid);
				expect(get(squares)).toHaveLength(100);
			});

			it('can update individual squares', () => {
				const grid = createEmptyGrid();
				squares.set(grid);

				squares.update((current) =>
					current.map((s) =>
						s.row_num === 0 && s.col_num === 0
							? { ...s, player_name: 'Alice', player_name_lower: 'alice' }
							: s
					)
				);

				const updated = get(squares);
				const targetSquare = updated.find((s) => s.row_num === 0 && s.col_num === 0);
				expect(targetSquare?.player_name).toBe('Alice');
			});
		});

		describe('numbers store', () => {
			it('initializes as null', () => {
				expect(get(numbers)).toBeNull();
			});

			it('can be set to numbers', () => {
				const mockNumbers = createMockNumbers();
				numbers.set(mockNumbers);
				expect(get(numbers)).toEqual(mockNumbers);
			});
		});

		describe('scores store', () => {
			it('initializes as null', () => {
				expect(get(scores)).toBeNull();
			});

			it('can be set to scores', () => {
				const mockScores = createMockScores({ q1_row_score: 7, q1_col_score: 3 });
				scores.set(mockScores);
				expect(get(scores)?.q1_row_score).toBe(7);
			});
		});

		describe('winners store', () => {
			it('initializes as empty array', () => {
				expect(get(winners)).toEqual([]);
			});

			it('can add winners', () => {
				winners.set([createMockWinner()]);
				expect(get(winners)).toHaveLength(1);
			});

			it('can append winners', () => {
				winners.set([createMockWinner({ id: '1', quarter: 'q1' })]);
				winners.update((w) => [...w, createMockWinner({ id: '2', quarter: 'q2' })]);
				expect(get(winners)).toHaveLength(2);
			});
		});

		describe('isLoading store', () => {
			it('initializes as true', () => {
				isLoading.set(true); // Reset to initial
				expect(get(isLoading)).toBe(true);
			});

			it('can be toggled', () => {
				isLoading.set(false);
				expect(get(isLoading)).toBe(false);
			});
		});

		describe('error store', () => {
			it('initializes as null', () => {
				expect(get(error)).toBeNull();
			});

			it('can be set to error message', () => {
				error.set('Something went wrong');
				expect(get(error)).toBe('Something went wrong');
			});
		});
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

	describe('selectedPlayerFilter', () => {
		it('initializes as null', () => {
			expect(get(selectedPlayerFilter)).toBeNull();
		});

		it('can be set to filter by player', () => {
			selectedPlayerFilter.set('alice');
			expect(get(selectedPlayerFilter)).toBe('alice');
		});

		it('can be cleared', () => {
			selectedPlayerFilter.set('alice');
			selectedPlayerFilter.set(null);
			expect(get(selectedPlayerFilter)).toBeNull();
		});
	});

	describe('pendingOperations', () => {
		it('initializes as empty Map', () => {
			expect(get(pendingOperations).size).toBe(0);
		});

		it('can add pending operations', () => {
			pendingOperations.update((ops) => {
				const newOps = new Map(ops);
				newOps.set('0-0', {
					id: 'test-op',
					type: 'claim',
					row: 0,
					col: 0,
					timestamp: Date.now(),
					status: 'pending',
					originalState: {
						player_name: null,
						player_name_lower: null,
						claimed_at: null,
					},
				});
				return newOps;
			});

			expect(get(pendingOperations).size).toBe(1);
			expect(get(pendingOperations).has('0-0')).toBe(true);
		});
	});

	describe('gameScores store', () => {
		it('initializes as null', () => {
			expect(get(gameScores)).toBeNull();
		});

		it('can be set to a game scores row', () => {
			const mockGs = createMockGameScores({ home_score: 14, away_score: 7 });
			gameScores.set(mockGs);
			expect(get(gameScores)?.home_score).toBe(14);
			expect(get(gameScores)?.away_score).toBe(7);
		});
	});

	describe('liveScores derived store', () => {
		it('returns null when gameScores is null', () => {
			party.set(createMockParty({ game_id: 'test-game-id', home_team_is_row: true }));
			gameScores.set(null);
			expect(get(liveScores)).toBeNull();
		});

		it('returns null when party is null', () => {
			party.set(null);
			gameScores.set(createMockGameScores({ home_score: 14, away_score: 7 }));
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

			const live = get(liveScores);
			expect(live).not.toBeNull();
			if (live) {
				expect(live.rowScore).toBe(14);
				expect(live.colScore).toBe(7);
				expect(live.clock).toBe('5:30');
				expect(live.quarter).toBe(2);
				expect(live.status).toBe('in_progress');
			}
		});

		it('maps away to row when home_team_is_row is false', () => {
			// Row team is Chiefs (the away team in the API), col team is Eagles (home)
			party.set(
				createMockParty({
					game_id: 'test-game-id',
					home_team_is_row: false,
					team_row_name: 'Chiefs',
					team_col_name: 'Eagles',
				})
			);
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 7,
				})
			);

			const live = get(liveScores);
			expect(live).not.toBeNull();
			if (live) {
				expect(live.rowScore).toBe(7);
				expect(live.colScore).toBe(14);
			}
		});

		it('defaults home_team_is_row to true when null', () => {
			party.set(createMockParty({ game_id: 'test-game-id', home_team_is_row: null }));
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 7,
				})
			);

			const live = get(liveScores);
			expect(live).not.toBeNull();
			if (live) {
				expect(live.rowScore).toBe(14);
				expect(live.colScore).toBe(7);
			}
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
			pendingOperations.update((ops) => {
				const newOps = new Map(ops);
				newOps.set('0-0', {
					id: 'test-op',
					type: 'claim',
					row: 0,
					col: 0,
					timestamp: Date.now(),
					status: 'pending',
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
			expect(get(error)).toBeNull();
			expect(get(pendingOperations).size).toBe(0);
		});
	});
});
