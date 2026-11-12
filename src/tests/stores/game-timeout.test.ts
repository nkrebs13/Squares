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
import { mockSupabaseClient, mockSupabaseChannel } from '../setup';
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

		// Mock RPC to never resolve (simulate hanging)
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		// Square should be claimed optimistically
		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);

		// Advance past timeout
		vi.advanceTimersByTime(10000);

		// Should be rolled back
		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});

	it('does not roll back before 10000ms', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		// Advance 9999ms — should NOT have rolled back
		vi.advanceTimersByTime(9999);

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);
	});
});

describe('subscription cleanup', () => {
	beforeEach(() => {
		cleanup();
	});

	it('cleanup clears pending timeouts', () => {
		vi.useFakeTimers();
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		userName.setName('Alice');

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnValue({ catch: vi.fn() }),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		expect(vi.getTimerCount()).toBe(1);

		cleanup();

		// The 10s rollback timer is cancelled, not just orphaned
		expect(vi.getTimerCount()).toBe(0);
		expect(get(pendingOperations).size).toBe(0);

		vi.useRealTimers();
	});

	it('cleanup unsubscribes both channels', () => {
		subscribeToParty('test-party-id');

		mockSupabaseChannel.unsubscribe.mockClear();
		cleanup();

		// channel + broadcastChannel, each exactly once
		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalledTimes(2);
	});

	it('subscribeToParty cleanup unsubscribes both channel and broadcastChannel', () => {
		const cleanupFn = subscribeToParty('test-party-id');

		mockSupabaseChannel.unsubscribe.mockClear();

		cleanupFn();

		// Both channel and broadcastChannel should be unsubscribed
		expect(mockSupabaseChannel.unsubscribe).toHaveBeenCalledTimes(2);
	});
});
