import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	claimSquareOptimistic,
	subscribeToParty,
	party,
	squares,
	pendingOperations,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import { channelHandler, rpcHangs } from '../setup';
import { createMockParty, createMockSquare } from '../factories';

describe('pending operation timeout', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		cleanup();
		userName.setName('Alice');
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('rolls back claim after 10000ms timeout', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);

		vi.advanceTimersByTime(10000);

		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});

	it('does not roll back before 10000ms', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);
		vi.advanceTimersByTime(9999);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);
	});

	it('remote unclaim_intent self-heals via timeout when no rejection arrives', () => {
		// A rejected unclaim changes zero rows, so postgres_changes never fires; the
		// op's own timeout is the only thing that can heal the other tabs.
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Bob',
				player_name_lower: 'bob',
				claimed_at: '2024-01-01T00:00:00Z',
			}),
		]);
		subscribeToParty('test-party-id');

		channelHandler(
			'broadcast',
			'square_update'
		)({
			payload: {
				type: 'unclaim_intent',
				squareKey: '0-0',
				playerName: 'Bob',
				timestamp: Date.now(),
				clientId: 'bob-client',
			},
		});

		// Optimistically cleared AND tracked as a pending op (so it can be healed).
		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(true);

		vi.advanceTimersByTime(10000);

		expect(get(squares)[0].player_name).toBe('Bob');
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});
});

describe('clearing pending operations when leaving a party', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('cleanup clears pending timeouts', () => {
		vi.useFakeTimers();
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		rpcHangs();

		claimSquareOptimistic(0, 0);
		expect(vi.getTimerCount()).toBe(1);

		cleanup();

		// The 10s rollback timer is cancelled, not just orphaned
		expect(vi.getTimerCount()).toBe(0);
		expect(get(pendingOperations).size).toBe(0);

		vi.useRealTimers();
	});
});
