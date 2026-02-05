import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { subscribeToParty, party, squares, pendingOperations, cleanup } from '$lib/stores/game';
import type { Party, Square, BroadcastMessage } from '$lib/types';
import { mockSupabaseClient, mockSupabaseChannel, mockChannelHandlers } from '../setup';

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

describe('subscribeToParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('creates two channels (broadcast + postgres_changes)', () => {
		subscribeToParty('test-party-id');
		// channel() called twice: once for broadcast, once for postgres_changes
		expect(mockSupabaseClient.channel).toHaveBeenCalledTimes(2);
		expect(mockSupabaseClient.channel).toHaveBeenCalledWith('party-broadcast:test-party-id');
		expect(mockSupabaseClient.channel).toHaveBeenCalledWith('party:test-party-id');
	});

	it('subscribes to broadcast events', () => {
		subscribeToParty('test-party-id');
		// Check that .on was called with 'broadcast' event
		expect(mockSupabaseChannel.on).toHaveBeenCalledWith(
			'broadcast',
			expect.objectContaining({ event: 'square_update' }),
			expect.any(Function)
		);
	});

	it('subscribes to postgres_changes for 5 tables', () => {
		subscribeToParty('test-party-id');

		// Check on was called for squares, parties, numbers, scores, winners
		const onCalls = mockSupabaseChannel.on.mock.calls;
		const pgChangesCalls = onCalls.filter((call: unknown[]) => call[0] === 'postgres_changes');

		const tables = pgChangesCalls.map(
			(call: unknown[]) => (call[1] as Record<string, string>).table
		);
		expect(tables).toContain('squares');
		expect(tables).toContain('parties');
		expect(tables).toContain('numbers');
		expect(tables).toContain('scores');
		expect(tables).toContain('winners');
	});

	it('returns cleanup function that unsubscribes channel', () => {
		const unsub = subscribeToParty('test-party-id');
		expect(typeof unsub).toBe('function');

		unsub();
		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalled();
	});

	it('unsubscribes previous channels on re-subscribe', () => {
		subscribeToParty('party-a');
		const unsubCalls = mockSupabaseChannel.unsubscribe.mock.calls.length;

		subscribeToParty('party-b');
		// Should have unsubscribed both previous channels
		expect(mockSupabaseChannel.unsubscribe.mock.calls.length).toBeGreaterThan(unsubCalls);
	});
});

describe('broadcast handler: claim_intent', () => {
	beforeEach(() => {
		cleanup();
	});

	it('ignores own clientId broadcasts', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		// Get the broadcast handler
		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return; // Handler not captured

		const message: BroadcastMessage = {
			type: 'claim_intent',
			squareKey: '0-0',
			playerName: 'Bob',
			timestamp: Date.now(),
			clientId: 'test-uuid-1234', // Same as our mocked clientId
		};

		broadcastHandler({ payload: message });

		// Should not have changed the square
		expect(get(squares)[0].player_name).toBeNull();
	});

	it('applies optimistic update from remote claim_intent', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		const message: BroadcastMessage = {
			type: 'claim_intent',
			squareKey: '0-0',
			playerName: 'Bob',
			timestamp: Date.now(),
			clientId: 'remote-client-123',
		};

		broadcastHandler({ payload: message });

		const sq = get(squares)[0];
		expect(sq.player_name).toBe('Bob');
		expect(sq.player_name_lower).toBe('bob');
	});

	it('skips if square is already claimed', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
		]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		const message: BroadcastMessage = {
			type: 'claim_intent',
			squareKey: '0-0',
			playerName: 'Bob',
			timestamp: Date.now(),
			clientId: 'remote-client-123',
		};

		broadcastHandler({ payload: message });

		// Should remain Alice
		expect(get(squares)[0].player_name).toBe('Alice');
	});

	it('adds remote pending operation', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		const message: BroadcastMessage = {
			type: 'claim_intent',
			squareKey: '0-0',
			playerName: 'Bob',
			timestamp: Date.now(),
			clientId: 'remote-client-123',
		};

		broadcastHandler({ payload: message });

		const ops = get(pendingOperations);
		const op = ops.get('0-0');
		expect(op).toBeDefined();
		expect(op?.id).toMatch(/^remote-/);
	});
});

describe('broadcast handler: claim_rejected', () => {
	beforeEach(() => {
		cleanup();
	});

	it('rolls back remote pending operation', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		// First: simulate remote claim
		broadcastHandler({
			payload: {
				type: 'claim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'remote-client-123',
			},
		});

		expect(get(squares)[0].player_name).toBe('Bob');

		// Then: simulate rejection
		broadcastHandler({
			payload: {
				type: 'claim_rejected',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'remote-client-123',
			},
		});

		// Should be rolled back to null
		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});
});

describe('broadcast handler: unclaim_intent', () => {
	beforeEach(() => {
		cleanup();
	});

	it('clears square on remote unclaim', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Bob',
				player_name_lower: 'bob',
				claimed_at: new Date().toISOString(),
			}),
		]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		broadcastHandler({
			payload: {
				type: 'unclaim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'remote-client-123',
			},
		});

		const sq = get(squares)[0];
		expect(sq.player_name).toBeNull();
		expect(sq.player_name_lower).toBeNull();
		expect(sq.claimed_at).toBeNull();
	});

	it('ignores own unclaim broadcasts', () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
		]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		broadcastHandler({
			payload: {
				type: 'unclaim_intent',
				squareKey: '0-0',
				playerName: 'Alice',
				timestamp: Date.now(),
				clientId: 'test-uuid-1234', // Own client
			},
		});

		expect(get(squares)[0].player_name).toBe('Alice');
	});

	it('skips if square is already empty', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		broadcastHandler({
			payload: {
				type: 'unclaim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'remote-client-123',
			},
		});

		// Should remain null (no crash)
		expect(get(squares)[0].player_name).toBeNull();
	});
});
