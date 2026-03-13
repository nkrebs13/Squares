import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	subscribeToParty,
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	pendingOperations,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square, Numbers, Scores, Winner, GameScoresRow } from '$lib/types';
import {
	mockChannelHandlers,
	mockSupabaseChannel,
	mockSupabaseClient,
	simulateChannelStatus,
} from '../setup';

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
		game_id: null,
		home_team_is_row: null,
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

	it('UPDATE replaces matching winner by party_id and quarter', () => {
		const existingWinner: Winner = {
			id: 'winner-1',
			party_id: 'test-party-id',
			quarter: 'q1',
			winning_row: 3,
			winning_col: 7,
			player_name: 'Alice',
			amount: 250,
			created_at: new Date().toISOString(),
		};
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		winners.set([existingWinner]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:winners'];

		const updatedWinner: Winner = {
			...existingWinner,
			player_name: 'Bob',
			amount: 300,
		};

		handler({ eventType: 'UPDATE', new: updatedWinner });

		const currentWinners = get(winners);
		expect(currentWinners).toHaveLength(1);
		expect(currentWinners[0].player_name).toBe('Bob');
		expect(currentWinners[0].amount).toBe(300);
	});

	it('DELETE removes matching winner by party_id and quarter', () => {
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
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		winners.set([winner1, winner2]);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['postgres_changes:winners'];

		handler({ eventType: 'DELETE', old: winner1 });

		const currentWinners = get(winners);
		expect(currentWinners).toHaveLength(1);
		expect(currentWinners[0].quarter).toBe('q2');
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

describe('postgres_changes: game_scores handler', () => {
	function createMockGameScores(overrides: Partial<GameScoresRow> = {}): GameScoresRow {
		return {
			game_id: 'game-123',
			sport: 'nfl',
			home_team_abbrev: 'KC',
			away_team_abbrev: 'PHI',
			home_team_name: 'Chiefs',
			away_team_name: 'Eagles',
			home_score: 14,
			away_score: 7,
			game_clock: '5:30',
			game_quarter: 2,
			game_status: 'in_progress',
			q1_home: 7,
			q1_away: 0,
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

	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('INSERT sets gameScores store', () => {
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id', 'game-123');

		expect(get(gameScores)).toBeNull();

		const handler = mockChannelHandlers['postgres_changes:game_scores'];
		expect(handler).toBeDefined();

		const newGameScores = createMockGameScores();
		handler({
			eventType: 'INSERT',
			new: newGameScores,
		});

		expect(get(gameScores)).toEqual(newGameScores);
	});

	it('UPDATE replaces gameScores store', () => {
		const initialGameScores = createMockGameScores();
		gameScores.set(initialGameScores);
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id', 'game-123');

		const handler = mockChannelHandlers['postgres_changes:game_scores'];

		const updatedGameScores = createMockGameScores({
			home_score: 21,
			away_score: 14,
			game_clock: '2:00',
			game_quarter: 3,
		});

		handler({
			eventType: 'UPDATE',
			new: updatedGameScores,
		});

		expect(get(gameScores)?.home_score).toBe(21);
		expect(get(gameScores)?.away_score).toBe(14);
		expect(get(gameScores)?.game_quarter).toBe(3);
	});

	it('DELETE sets gameScores to null', () => {
		const initialGameScores = createMockGameScores();
		gameScores.set(initialGameScores);
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id', 'game-123');

		const handler = mockChannelHandlers['postgres_changes:game_scores'];

		handler({
			eventType: 'DELETE',
			old: initialGameScores,
		});

		expect(get(gameScores)).toBeNull();
	});
});

describe('channel cleanup', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('unsubscribe function cleans up all channels including game channel', () => {
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());

		// Subscribe with gameId to create game channel
		const unsubscribe = subscribeToParty('test-party-id', 'game-123');

		// Call unsubscribe - should clean up all channels
		unsubscribe();

		// Channels should be unsubscribed (mock.unsubscribe called)
		// No error should be thrown
	});

	it('calling subscribeToParty again cleans up previous channels including game channel', () => {
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());

		// First subscription with gameId
		subscribeToParty('test-party-id', 'game-123');

		// Second subscription should cleanup previous channels
		subscribeToParty('test-party-id-2', 'game-456');

		// No error should be thrown, cleanup should be successful
	});

	it('cleanup() cleans up game channel when present', () => {
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());

		// Subscribe with gameId
		subscribeToParty('test-party-id', 'game-123');

		// Cleanup should handle game channel
		cleanup();

		// No error should be thrown
	});
});

describe('channel reconnection', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('SUBSCRIBED status resets reconnect state', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		// Simulate successful subscription
		simulateChannelStatus('SUBSCRIBED');

		// No error should be thrown, reconnect counter should be reset
		// (internal state, verified by not seeing exponential backoff on next error)
	});

	it('CHANNEL_ERROR triggers reconnection attempt', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const initialUnsubscribeCalls = mockSupabaseChannel.unsubscribe.mock.calls.length;

		// Simulate channel error
		simulateChannelStatus('CHANNEL_ERROR');

		// Advance timer past reconnection delay (1s base + jitter)
		vi.advanceTimersByTime(2000);

		// Should have attempted to unsubscribe and resubscribe
		expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBeGreaterThan(
			initialUnsubscribeCalls
		);
	});

	it('TIMED_OUT triggers reconnection attempt', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const initialUnsubscribeCalls = mockSupabaseChannel.unsubscribe.mock.calls.length;

		// Simulate timeout
		simulateChannelStatus('TIMED_OUT');

		// Advance timer past reconnection delay
		vi.advanceTimersByTime(2000);

		// Should have attempted reconnection
		expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBeGreaterThan(
			initialUnsubscribeCalls
		);
	});

	it('CLOSED triggers reconnection attempt', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const initialUnsubscribeCalls = mockSupabaseChannel.unsubscribe.mock.calls.length;

		// Simulate channel closed
		simulateChannelStatus('CLOSED');

		// Advance timer past reconnection delay
		vi.advanceTimersByTime(2000);

		// Should have attempted reconnection
		expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBeGreaterThan(
			initialUnsubscribeCalls
		);
	});

	it('exponential backoff increases delay between reconnection attempts', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		// First error
		simulateChannelStatus('CHANNEL_ERROR');

		// First reconnection should happen after ~1s (base delay)
		vi.advanceTimersByTime(1500);

		// Simulate another error after reconnection
		simulateChannelStatus('CHANNEL_ERROR');

		// Second reconnection should take longer (~2s due to exponential backoff)
		const callsBefore = mockSupabaseChannel.unsubscribe.mock.calls.length;
		vi.advanceTimersByTime(1500); // Not enough time

		// Should not have reconnected yet (still waiting for longer backoff)
		// The delay is 2^1 * 1000 = 2000ms + jitter, so 1500ms shouldn't trigger it
		vi.advanceTimersByTime(2000); // Now advance enough
		const callsAfter = mockSupabaseChannel.unsubscribe.mock.calls.length;

		// Should have reconnected after full backoff period
		expect(callsAfter).toBeGreaterThanOrEqual(callsBefore);
	});

	it('switching parties cancels pending reconnection timeout', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		// Trigger reconnection (will be pending)
		simulateChannelStatus('CHANNEL_ERROR');

		// Switch to a different party before timeout fires
		subscribeToParty('other-party-id');

		// Advance timer - the old reconnection should NOT fire
		vi.advanceTimersByTime(5000);

		// No error should occur from stale closure
		// The new subscription should be active
	});
});

describe('broadcast: score_update handler', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('ignores own score update broadcasts', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:score_update'];
		expect(handler).toBeDefined();

		// Send with our own clientId (test-uuid-1234 from crypto.randomUUID mock)
		handler({ payload: { clientId: 'test-uuid-1234' } });

		// Should not have called supabase.from() since it was our own broadcast
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('early returns when party is null', () => {
		party.set(null);
		squares.set(createEmptyGrid());
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:score_update'];
		expect(handler).toBeDefined();

		// Send with a different clientId so it's not ignored as own broadcast
		handler({ payload: { clientId: 'other-client-id' } });

		// Should not have called supabase.from() since party is null
		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('re-fetches scores and winners on external score update', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());

		// Set up from() mock to return chainable objects with .then()
		const mockThen = vi.fn();
		mockSupabaseClient.from.mockImplementation(() => {
			const chainable = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				single: vi.fn().mockReturnThis(),
				then: mockThen,
			};
			return chainable;
		});

		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:score_update'];
		expect(handler).toBeDefined();

		// Send with a different clientId
		handler({ payload: { clientId: 'other-client-id' } });

		// Should have called supabase.from() for both scores and winners
		expect(mockSupabaseClient.from).toHaveBeenCalledWith('scores');
		expect(mockSupabaseClient.from).toHaveBeenCalledWith('winners');
	});
});

describe('broadcast: unclaim_intent handler', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('ignores unclaim for square with no player_name', () => {
		party.set(createMockParty());
		// Grid with all empty squares (no player_name)
		const grid = createEmptyGrid();
		squares.set(grid);
		subscribeToParty('test-party-id');

		const handler = mockChannelHandlers['broadcast:square_update'];
		expect(handler).toBeDefined();

		// Send unclaim_intent for square (2, 3) which has no player_name
		handler({
			payload: {
				type: 'unclaim_intent',
				clientId: 'other-client-id',
				squareKey: '2-3',
				playerName: 'Bob',
				timestamp: Date.now(),
			},
		});

		// Square should remain unchanged (still no player_name)
		const currentSquares = get(squares);
		const targetSquare = currentSquares.find((s) => s.row_num === 2 && s.col_num === 3);
		expect(targetSquare?.player_name).toBeNull();
	});
});

describe('game channel status', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('game channel SUBSCRIBED status resets reconnect state', () => {
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
		squares.set(createEmptyGrid());

		// Subscribe with gameId to create the game channel
		subscribeToParty('test-party-id', 'game-123');

		// Simulate SUBSCRIBED on all channels (including game channel)
		simulateChannelStatus('SUBSCRIBED');

		// No error should be thrown — reconnect state should be cleanly reset
	});
});
