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
	leadingSquare,
	gridState,
	filledCount,
	isGridFull,
	mySquares,
	mySquareCount,
	amountOwed,
	playerSummary,
	availableCount,
	selectedPlayerFilter,
	activePlayerFilter,
	teamTheme,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import { DEFAULT_TEAMS } from '$lib/config';
import type { PartyStatus } from '$lib/types';
import {
	createEmptyGrid,
	createMockGameScores,
	createMockNumbers,
	createMockParty,
	createMockScores,
	createMockSquare,
	createMockWinner,
} from '../factories';

/** An empty grid where each listed cell is owned by the given player. */
function gridOwnedBy(owned: Array<[index: number, name: string]>) {
	const grid = createEmptyGrid();
	for (const [i, name] of owned) {
		grid[i].player_name = name;
		grid[i].player_name_lower = name.toLowerCase();
	}
	return grid;
}

/** Every cell taken, so only the count-based stores see a difference. */
function fullGrid() {
	return createEmptyGrid().map((s) => ({ ...s, player_name: 'Player' }));
}

/** Remove the owner of one cell, the way an unclaim does to the squares store. */
function clearOwner(row: number, col: number) {
	squares.update((current) =>
		current.map((s) =>
			s.row_num === row && s.col_num === col
				? { ...s, player_name: null, player_name_lower: null }
				: s
		)
	);
}

beforeEach(() => {
	cleanup();
	userName.setName('TestUser');
});

describe('gridState', () => {
	it('returns null when party is null', () => {
		expect(get(gridState)).toBeNull();
	});

	it('returns combined state when party is set', () => {
		const mockParty = createMockParty();
		const mockNumbers = createMockNumbers();
		const mockScores = createMockScores();

		party.set(mockParty);
		squares.set(createEmptyGrid());
		numbers.set(mockNumbers);
		scores.set(mockScores);
		winners.set([createMockWinner()]);

		const state = get(gridState);
		expect(state).not.toBeNull();
		expect(state?.party).toEqual(mockParty);
		expect(state?.squares).toHaveLength(100);
		expect(state?.numbers).toEqual(mockNumbers);
		expect(state?.scores).toEqual(mockScores);
		expect(state?.winners).toHaveLength(1);
	});
});

describe('grid counts', () => {
	it('filledCount returns 0 for empty grid', () => {
		squares.set(createEmptyGrid());
		expect(get(filledCount)).toBe(0);
	});

	it('filledCount counts claimed squares correctly', () => {
		squares.set(
			gridOwnedBy([
				[0, 'Alice'],
				[1, 'Bob'],
				[2, 'Charlie'],
			])
		);
		expect(get(filledCount)).toBe(3);
	});

	it('filledCount returns 100 for full grid', () => {
		squares.set(fullGrid());
		expect(get(filledCount)).toBe(100);
	});

	it('isGridFull is false for an empty and a partially filled grid, true for a full one', () => {
		squares.set(createEmptyGrid());
		expect(get(isGridFull)).toBe(false);

		squares.set(gridOwnedBy([[0, 'Alice']]));
		expect(get(isGridFull)).toBe(false);

		squares.set(fullGrid());
		expect(get(isGridFull)).toBe(true);
	});

	it('availableCount counts the unclaimed squares', () => {
		squares.set(createEmptyGrid());
		expect(get(availableCount)).toBe(100);

		squares.set(
			gridOwnedBy([
				[0, 'Alice'],
				[1, 'Bob'],
			])
		);
		expect(get(availableCount)).toBe(98);

		squares.set(fullGrid());
		expect(get(availableCount)).toBe(0);
	});
});

describe('the current player squares', () => {
	it('mySquares is empty when there is no userName', async () => {
		await userName.clear();
		squares.set(createEmptyGrid());

		expect(get(mySquares)).toEqual([]);
	});

	it('mySquares holds only squares belonging to current user', async () => {
		await userName.setName('Alice');
		squares.set(
			gridOwnedBy([
				[0, 'Alice'],
				[1, 'Bob'],
				[2, 'Alice'],
			])
		);

		const mine = get(mySquares);
		expect(mine).toHaveLength(2);
		expect(mine.every((s) => s.player_name_lower === 'alice')).toBe(true);
	});

	it('mySquares is case insensitive', async () => {
		await userName.setName('ALICE');
		squares.set(gridOwnedBy([[0, 'alice']]));

		expect(get(mySquares)).toHaveLength(1);
	});

	it('mySquareCount counts the user squares', async () => {
		await userName.setName('Alice');
		squares.set(
			gridOwnedBy([
				[0, 'Alice'],
				[1, 'Alice'],
				[2, 'Alice'],
			])
		);

		expect(get(mySquareCount)).toBe(3);
	});

	it('amountOwed is 0 when there is no party', async () => {
		await userName.setName('Alice');
		party.set(null);
		expect(get(amountOwed)).toBe(0);
	});

	it('amountOwed multiplies the squares by the price', async () => {
		await userName.setName('Alice');
		party.set(createMockParty({ square_price: 5 }));
		squares.set(
			gridOwnedBy([
				[0, 'Alice'],
				[1, 'Alice'],
			])
		);

		expect(get(amountOwed)).toBe(10);
	});
});

describe('playerSummary', () => {
	it('returns empty array for empty grid', () => {
		squares.set(createEmptyGrid());
		expect(get(playerSummary)).toEqual([]);
	});

	it('groups players and counts correctly, most squares first', () => {
		squares.set(
			gridOwnedBy([
				[0, 'Alice'],
				[1, 'Alice'],
				[2, 'Alice'],
				[3, 'Bob'],
				[4, 'Bob'],
			])
		);

		const summary = get(playerSummary);
		expect(summary).toHaveLength(2);
		expect(summary[0]).toMatchObject({ name: 'Alice', count: 3 });
		expect(summary[1]).toMatchObject({ name: 'Bob', count: 2 });
	});

	it('handles case variations correctly', () => {
		const grid = gridOwnedBy([
			[0, 'Alice'],
			[1, 'ALICE'],
		]);
		grid[1].player_name_lower = 'alice';
		squares.set(grid);

		const summary = get(playerSummary);
		expect(summary).toHaveLength(1);
		expect(summary[0].count).toBe(2);
	});
});

describe('liveScores', () => {
	it('returns null when gameScores is null', () => {
		party.set(createMockParty({ game_id: 'test-game-id', home_team_is_row: true }));
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
		gameScores.set(createMockGameScores({ home_score: 14, away_score: 7 }));

		expect(get(liveScores)).toMatchObject({ rowScore: 7, colScore: 14 });
	});
});

describe('leadingSquare', () => {
	function liveGame(opts: {
		partyStatus?: PartyStatus;
		home: number;
		away: number;
		gameStatus?: 'pregame' | 'in_progress' | 'final';
	}) {
		party.set(createMockParty({ status: opts.partyStatus ?? 'active' }));
		gameScores.set(
			createMockGameScores({
				home_score: opts.home,
				away_score: opts.away,
				game_status: opts.gameStatus ?? 'in_progress',
			})
		);
	}

	it('returns null when liveScores is null', () => {
		party.set(createMockParty({ status: 'active' }));
		numbers.set(createMockNumbers());
		gameScores.set(null);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when numbers is null', () => {
		liveGame({ home: 14, away: 7 });
		numbers.set(null);
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when party is null', () => {
		liveGame({ home: 14, away: 7 });
		numbers.set(createMockNumbers());
		party.set(null);
		expect(get(leadingSquare)).toBeNull();
	});

	it.each<PartyStatus>(['filling', 'complete'])(
		'returns null when party status is %s',
		(status) => {
			liveGame({ partyStatus: status, home: 14, away: 7 });
			numbers.set(createMockNumbers());
			expect(get(leadingSquare)).toBeNull();
		}
	);

	it.each(['final', 'pregame'] as const)('returns null when game status is %s', (gameStatus) => {
		liveGame({ home: 14, away: 7, gameStatus });
		numbers.set(createMockNumbers());
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when row digit not found in numbers', () => {
		liveGame({ home: 14, away: 7 });
		// Row numbers don't contain 4 (last digit of 14)
		numbers.set(createMockNumbers({ row_numbers: [0, 1, 2, 3, 5, 6, 7, 8, 9, 0] }));
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns null when col digit not found in numbers', () => {
		liveGame({ home: 14, away: 7 });
		// Col numbers don't contain 7 (last digit of 7)
		numbers.set(createMockNumbers({ col_numbers: [0, 1, 2, 3, 4, 5, 6, 8, 9, 0] }));
		expect(get(leadingSquare)).toBeNull();
	});

	it('returns correct leading square for active party', () => {
		liveGame({ home: 14, away: 7 });
		numbers.set(createMockNumbers());
		// Row score 14 -> last digit 4, column score 7 -> last digit 7
		expect(get(leadingSquare)).toEqual({ row: 4, col: 7 });
	});

	it('returns correct leading square for locked party', () => {
		liveGame({ partyStatus: 'locked', home: 21, away: 10 });
		numbers.set(createMockNumbers());
		expect(get(leadingSquare)).toEqual({ row: 1, col: 0 });
	});

	it('uses shuffled numbers correctly', () => {
		liveGame({ home: 14, away: 7 });
		// Digit 4 sits at index 8 of the row numbers, digit 7 at index 2 of the column numbers
		numbers.set(
			createMockNumbers({
				row_numbers: [9, 8, 7, 6, 5, 3, 2, 1, 4, 0],
				col_numbers: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
			})
		);
		expect(get(leadingSquare)).toEqual({ row: 8, col: 2 });
	});
});

describe('activePlayerFilter follows the squares', () => {
	// A picked player's highlight must go away when their last square does,
	// instead of dimming the whole grid for a player with nothing on it.
	it('clears the filter when the last matching square is unclaimed directly on the squares store', () => {
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		selectedPlayerFilter.set('alice');
		expect(get(selectedPlayerFilter)).toBe('alice');

		clearOwner(0, 0);

		expect(get(activePlayerFilter)).toBeNull();
	});

	it('leaves the filter untouched while the filtered player still has other squares remaining', () => {
		squares.set([
			createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' }),
			createMockSquare(0, 1, { player_name: 'Alice', player_name_lower: 'alice' }),
		]);
		selectedPlayerFilter.set('alice');

		clearOwner(0, 0);

		expect(get(selectedPlayerFilter)).toBe('alice');
	});

	it('does not touch the filter when it is already null', () => {
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		expect(get(activePlayerFilter)).toBeNull();

		squares.set([]);

		expect(get(activePlayerFilter)).toBeNull();
	});
});

describe('teamTheme', () => {
	it('uses the configured default teams before a party loads', () => {
		expect(get(teamTheme)).toEqual({
			rowName: DEFAULT_TEAMS.row.name,
			colName: DEFAULT_TEAMS.col.name,
			rowColor: DEFAULT_TEAMS.row.color,
			colColor: DEFAULT_TEAMS.col.color,
		});
	});

	it('follows the party, including edits made after it loaded', () => {
		party.set(createMockParty({ team_row_name: 'Eagles', team_row_color: '#004C54' }));
		expect(get(teamTheme)).toMatchObject({ rowName: 'Eagles', rowColor: '#004C54' });

		party.update((p) => (p ? { ...p, team_row_name: 'Ravens', team_row_color: '#241773' } : p));
		expect(get(teamTheme)).toMatchObject({ rowName: 'Ravens', rowColor: '#241773' });
	});

	it('goes back to the defaults when leaving the party', () => {
		party.set(createMockParty({ team_row_name: 'Eagles' }));
		cleanup();
		expect(get(teamTheme).rowName).toBe(DEFAULT_TEAMS.row.name);
	});
});
