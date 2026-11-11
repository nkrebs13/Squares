import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	party,
	squares,
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import { mockSupabaseClient } from '../setup';
import { createMockParty, createMockSquare } from '../factories';

describe('claimSquareOptimistic', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('updates square immediately with player name', () => {
		const mockParty = createMockParty();
		party.set(mockParty);
		userName.setName('Alice');
		const mockSquare = createMockSquare(0, 0);
		squares.set([mockSquare]);

		// Mock the RPC call to not fail
		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnThis(),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		claimSquareOptimistic(0, 0);

		const updated = get(squares);
		expect(updated[0].player_name).toBe('Alice');
		expect(updated[0].player_name_lower).toBe('alice');
	});

	it('does nothing when party is not in filling status', () => {
		const mockParty = createMockParty({ status: 'active' });
		party.set(mockParty);
		userName.setName('Alice');
		const mockSquare = createMockSquare(0, 0);
		squares.set([mockSquare]);

		claimSquareOptimistic(0, 0);

		const updated = get(squares);
		expect(updated[0].player_name).toBeNull();
	});
});

describe('unclaimSquareOptimistic', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('clears square immediately', async () => {
		const mockParty = createMockParty();
		party.set(mockParty);
		await userName.setName('Alice');
		const mockSquare = createMockSquare(0, 0, {
			player_name: 'Alice',
			player_name_lower: 'alice',
			claimed_at: new Date().toISOString(),
		});
		squares.set([mockSquare]);

		mockSupabaseClient.rpc.mockReturnValue({
			then: vi.fn().mockReturnThis(),
		} as unknown as ReturnType<typeof mockSupabaseClient.rpc>);

		unclaimSquareOptimistic(0, 0);

		const updated = get(squares);
		expect(updated[0].player_name).toBeNull();
	});
});
