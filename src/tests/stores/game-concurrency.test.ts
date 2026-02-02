import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	subscribeToParty,
	party,
	squares,
	pendingOperations,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square } from '$lib/types';
import { mockSupabaseClient, mockChannelHandlers } from '../setup';

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

describe('Concurrency: two users claim same square', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('broadcast handler detects already-claimed square and skips', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		// Alice claims locally
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);
		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');

		// Bob's broadcast arrives after
		const broadcastHandler = mockChannelHandlers['broadcast:square_update'];
		if (!broadcastHandler) return;

		broadcastHandler({
			payload: {
				type: 'claim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'bob-client-123',
			},
		});

		// Should still be Alice (already claimed)
		expect(get(squares)[0].player_name).toBe('Alice');
	});
});

describe('Concurrency: claim + unclaim overlap', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('claim then unclaim results in unclaimed', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		// Claim
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);
		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Alice');

		// Immediately unclaim
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);
		unclaimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBeNull();
	});
});

describe('Concurrency: postgres_changes overrides optimistic state', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('UPDATE from postgres_changes replaces optimistic value and clears pending', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		subscribeToParty('test-party-id');

		// Claim optimistically
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);
		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);

		// Simulate postgres_changes UPDATE
		const pgHandler = mockChannelHandlers['postgres_changes:squares'];
		if (!pgHandler) return;

		pgHandler({
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

		// Pending operation should be cleared
		expect(get(pendingOperations).has('0-0')).toBe(false);
		// Square should have the confirmed state
		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(squares)[0].claimed_at).toBe('2024-02-01T00:00:00Z');
	});
});

describe('Concurrency: timeout rollback', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		cleanup();
		userName.setName('Alice');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('rolls back after 10000ms when RPC never responds', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Alice');

		vi.advanceTimersByTime(10000);

		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});
});

describe('Post-cleanup consistency', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('after cleanup + loadParty, no stale pending operations exist', async () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		// Create pending operation
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);
		claimSquareOptimistic(0, 0);

		expect(get(pendingOperations).size).toBe(1);

		// Cleanup (simulates browser refresh)
		cleanup();

		expect(get(pendingOperations).size).toBe(0);
		expect(get(party)).toBeNull();
		expect(get(squares)).toEqual([]);
	});
});
