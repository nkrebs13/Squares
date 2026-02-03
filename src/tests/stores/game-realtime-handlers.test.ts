import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	subscribeToParty,
	party,
	squares,
	numbers,
	scores,
	winners,
	pendingOperations,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square, Numbers, Scores, Winner } from '$lib/types';
import { mockChannelHandlers } from '../setup';

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

describe('postgres_changes: parties handler', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('UPDATE sets party store on filling→active transition', () => {
		party.set(createMockParty({ status: 'filling' }));
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:parties'];
		expect(handler).toBeDefined();

		const updatedParty = createMockParty({ status: 'active' });
		handler({
			eventType: 'UPDATE',
			new: updatedParty,
		});

		expect(get(party)?.status).toBe('active');
	});

	it('UPDATE sets party store on active→complete transition', () => {
		party.set(createMockParty({ status: 'active' }));
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:parties'];

		const updatedParty = createMockParty({ status: 'complete' });
		handler({
			eventType: 'UPDATE',
			new: updatedParty,
		});

		expect(get(party)?.status).toBe('complete');
	});

	it('ignores non-UPDATE events', () => {
		const originalParty = createMockParty({ status: 'filling' });
		party.set(originalParty);
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:parties'];

		handler({
			eventType: 'INSERT',
			new: createMockParty({ status: 'active' }),
		});

		expect(get(party)?.status).toBe('filling');
	});
});

describe('postgres_changes: numbers handler', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('INSERT sets numbers store', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		expect(get(numbers)).toBeNull();

		const handler = mockChannelHandlers['postgres_changes:numbers'];
		expect(handler).toBeDefined();

		const newNumbers: Numbers = {
			party_id: 'test-party-id',
			row_numbers: [3, 7, 1, 9, 0, 5, 8, 2, 6, 4],
			col_numbers: [6, 2, 8, 0, 4, 1, 9, 5, 3, 7],
			assigned_at: new Date().toISOString(),
		};

		handler({
			eventType: 'INSERT',
			new: newNumbers,
		});

		expect(get(numbers)).toEqual(newNumbers);
	});

	it('UPDATE replaces numbers store', () => {
		const initialNumbers: Numbers = {
			party_id: 'test-party-id',
			row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			assigned_at: new Date().toISOString(),
		};
		numbers.set(initialNumbers);
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:numbers'];

		const updatedNumbers: Numbers = {
			party_id: 'test-party-id',
			row_numbers: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
			col_numbers: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
			assigned_at: new Date().toISOString(),
		};

		handler({
			eventType: 'UPDATE',
			new: updatedNumbers,
		});

		expect(get(numbers)).toEqual(updatedNumbers);
	});

	it('ignores DELETE events', () => {
		const initialNumbers: Numbers = {
			party_id: 'test-party-id',
			row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			assigned_at: new Date().toISOString(),
		};
		numbers.set(initialNumbers);
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:numbers'];

		handler({
			eventType: 'DELETE',
			old: initialNumbers,
		});

		// Should still have the initial numbers
		expect(get(numbers)).toEqual(initialNumbers);
	});
});

describe('postgres_changes: scores handler', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('INSERT sets scores store', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		expect(get(scores)).toBeNull();

		const handler = mockChannelHandlers['postgres_changes:scores'];
		expect(handler).toBeDefined();

		const newScores: Scores = {
			party_id: 'test-party-id',
			q1_row_score: 7,
			q1_col_score: 3,
			q2_row_score: null,
			q2_col_score: null,
			q3_row_score: null,
			q3_col_score: null,
			final_row_score: null,
			final_col_score: null,
		};

		handler({
			eventType: 'INSERT',
			new: newScores,
		});

		expect(get(scores)).toEqual(newScores);
	});

	it('UPDATE replaces scores store', () => {
		const initialScores: Scores = {
			party_id: 'test-party-id',
			q1_row_score: 7,
			q1_col_score: 3,
			q2_row_score: null,
			q2_col_score: null,
			q3_row_score: null,
			q3_col_score: null,
			final_row_score: null,
			final_col_score: null,
		};
		scores.set(initialScores);
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:scores'];

		const updatedScores: Scores = {
			...initialScores,
			q2_row_score: 14,
			q2_col_score: 10,
		};

		handler({
			eventType: 'UPDATE',
			new: updatedScores,
		});

		expect(get(scores)).toEqual(updatedScores);
		expect(get(scores)?.q2_row_score).toBe(14);
		expect(get(scores)?.q2_col_score).toBe(10);
	});
});

describe('postgres_changes: winners handler', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('INSERT appends to winners store (not replace)', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		winners.set([]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:winners'];
		expect(handler).toBeDefined();

		const winner: Winner = {
			id: 'winner-1',
			party_id: 'test-party-id',
			quarter: 'q1',
			winning_row: 3,
			winning_col: 7,
			player_name: 'Alice',
			amount: 250,
			created_at: new Date().toISOString(),
		};

		handler({
			eventType: 'INSERT',
			new: winner,
		});

		const currentWinners = get(winners);
		expect(currentWinners).toHaveLength(1);
		expect(currentWinners[0]).toEqual(winner);
	});

	it('multiple INSERTs accumulate correctly', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		winners.set([]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:winners'];

		const winner1: Winner = {
			id: 'winner-1',
			party_id: 'test-party-id',
			quarter: 'q1',
			winning_row: 3,
			winning_col: 7,
			player_name: 'Alice',
			amount: 250,
			created_at: new Date().toISOString(),
		};

		const winner2: Winner = {
			id: 'winner-2',
			party_id: 'test-party-id',
			quarter: 'q2',
			winning_row: 1,
			winning_col: 4,
			player_name: 'Bob',
			amount: 500,
			created_at: new Date().toISOString(),
		};

		const winner3: Winner = {
			id: 'winner-3',
			party_id: 'test-party-id',
			quarter: 'q3',
			winning_row: 9,
			winning_col: 2,
			player_name: 'Alice',
			amount: 750,
			created_at: new Date().toISOString(),
		};

		handler({ eventType: 'INSERT', new: winner1 });
		handler({ eventType: 'INSERT', new: winner2 });
		handler({ eventType: 'INSERT', new: winner3 });

		const currentWinners = get(winners);
		expect(currentWinners).toHaveLength(3);
		expect(currentWinners[0].quarter).toBe('q1');
		expect(currentWinners[1].quarter).toBe('q2');
		expect(currentWinners[2].quarter).toBe('q3');
	});

	it('INSERT appends to existing winners', () => {
		const existingWinner: Winner = {
			id: 'winner-existing',
			party_id: 'test-party-id',
			quarter: 'q1',
			winning_row: 0,
			winning_col: 0,
			player_name: 'Charlie',
			amount: 250,
			created_at: new Date().toISOString(),
		};
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		winners.set([existingWinner]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:winners'];

		const newWinner: Winner = {
			id: 'winner-new',
			party_id: 'test-party-id',
			quarter: 'q2',
			winning_row: 5,
			winning_col: 5,
			player_name: 'Dave',
			amount: 500,
			created_at: new Date().toISOString(),
		};

		handler({ eventType: 'INSERT', new: newWinner });

		const currentWinners = get(winners);
		expect(currentWinners).toHaveLength(2);
		expect(currentWinners[0]).toEqual(existingWinner);
		expect(currentWinners[1]).toEqual(newWinner);
	});
});

describe('postgres_changes: squares handler (completeness)', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('UPDATE clears pending op AND updates square with confirmed state', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		// Manually add a pending operation
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

		expect(get(pendingOperations).has('0-0')).toBe(true);

		const handler = mockChannelHandlers['postgres_changes:squares'];
		expect(handler).toBeDefined();

		handler({
			eventType: 'UPDATE',
			new: {
				id: 'sq-0-0',
				party_id: 'test-party-id',
				row_num: 0,
				col_num: 0,
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: '2024-02-01T00:00:00Z',
			},
		});

		expect(get(pendingOperations).has('0-0')).toBe(false);
		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(squares)[0].claimed_at).toBe('2024-02-01T00:00:00Z');
	});
});
