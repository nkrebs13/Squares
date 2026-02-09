import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	loadParty,
	party,
	squares,
	numbers,
	isLoading,
	error,
	verifyHostPin,
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquare,
	claimSquaresBatch,
	unclaimSquare,
	cleanup,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Party, Square } from '$lib/types';
import { mockSupabaseClient } from '../setup';

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

describe('loadParty', () => {
	beforeEach(() => {
		cleanup();
		vi.clearAllMocks();
	});

	it('fetches and populates all stores on success', async () => {
		const mockParty = createMockParty({ status: 'active' });
		const mockSquares = [createMockSquare(0, 0), createMockSquare(0, 1)];
		const mockNumbers = {
			party_id: 'test-party-id',
			row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			assigned_at: new Date().toISOString(),
		};
		const mockScores = { party_id: 'test-party-id', q1_row_score: 14, q1_col_score: 7 };
		const mockWinners = [
			{
				id: 'w1',
				party_id: 'test-party-id',
				quarter: 'q1',
				winning_row: 4,
				winning_col: 7,
				player_name: 'Alice',
				amount: 250,
				created_at: new Date().toISOString(),
			},
		];

		// Mock chain for party fetch
		const mockPartyChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: mockParty, error: null }),
			order: vi.fn().mockReturnThis(),
		};
		// Mock chain for game_scores auto-detect (party has no game_id)
		const mockAutoDetectChain = {
			select: vi.fn().mockReturnThis(),
			neq: vi.fn().mockReturnThis(),
			limit: vi.fn().mockReturnThis(),
			maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
		};
		// Mock chain for squares fetch
		const mockSquaresChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: mockSquares, error: null }),
		};
		// Override the order chain to resolve with data
		mockSquaresChain.order
			.mockReturnValueOnce(mockSquaresChain) // first .order('row_num')
			.mockResolvedValueOnce({ data: mockSquares, error: null }); // second .order('col_num')

		// Mock chain for numbers
		const mockNumbersChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: mockNumbers, error: null }),
		};
		// Mock chain for scores
		const mockScoresChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: mockScores, error: null }),
		};
		// Mock chain for winners
		const mockWinnersChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockResolvedValue({ data: mockWinners, error: null }),
		};

		mockSupabaseClient.from
			.mockReturnValueOnce(mockPartyChain as ReturnType<typeof mockSupabaseClient.from>) // parties
			.mockReturnValueOnce(
				mockAutoDetectChain as unknown as ReturnType<typeof mockSupabaseClient.from>
			) // game_scores auto-detect
			.mockReturnValueOnce(mockSquaresChain as ReturnType<typeof mockSupabaseClient.from>) // squares
			.mockReturnValueOnce(mockNumbersChain as ReturnType<typeof mockSupabaseClient.from>) // numbers
			.mockReturnValueOnce(mockScoresChain as ReturnType<typeof mockSupabaseClient.from>) // scores
			.mockReturnValueOnce(mockWinnersChain as ReturnType<typeof mockSupabaseClient.from>); // winners

		const result = await loadParty('TEST123');

		expect(result).toBe(true);
		expect(get(party)).toEqual(mockParty);
		expect(get(squares)).toEqual(mockSquares);
		expect(get(numbers)).toEqual(mockNumbers);
		expect(get(isLoading)).toBe(false);
	});

	it('sets error on party not found', async () => {
		const mockChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: null, error: { message: 'Not found' } }),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		const result = await loadParty('INVALID');

		expect(result).toBe(false);
		expect(get(error)).toBe('Party not found');
		expect(get(isLoading)).toBe(false);
	});

	it('sets isLoading true at start and false when done', async () => {
		const mockChain = {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockResolvedValue({ data: null, error: { message: 'err' } }),
		};
		mockSupabaseClient.from.mockReturnValueOnce(
			mockChain as ReturnType<typeof mockSupabaseClient.from>
		);

		// Before call
		isLoading.set(false);
		const promise = loadParty('TEST');
		// During call - loading should be true
		expect(get(isLoading)).toBe(true);
		await promise;
		expect(get(isLoading)).toBe(false);
	});
});

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

describe('verifyHostPin', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns true on success', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
		const result = await verifyHostPin('TEST123', '1234');
		expect(result).toBe(true);
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('verify_host_pin', {
			p_party_code: 'TEST123',
			p_pin: '1234',
		});
	});

	it('returns false on RPC error', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'Invalid' },
		});
		const result = await verifyHostPin('TEST123', 'wrong');
		expect(result).toBe(false);
	});

	it('returns false when data is not true', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });
		const result = await verifyHostPin('TEST123', 'wrong');
		expect(result).toBe(false);
	});
});

describe('claimSquare (legacy)', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('returns false when no party loaded', async () => {
		const result = await claimSquare(0, 0);
		expect(result).toBe(false);
	});

	it('returns false when no user name', async () => {
		await userName.clear();
		party.set(createMockParty());
		const result = await claimSquare(0, 0);
		expect(result).toBe(false);
	});

	it('returns false when party status is not filling', async () => {
		party.set(createMockParty({ status: 'active' }));
		const result = await claimSquare(0, 0);
		expect(result).toBe(false);
		expect(mockSupabaseClient.rpc).not.toHaveBeenCalled();
	});

	it('returns true on RPC success', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
		const result = await claimSquare(0, 0);
		expect(result).toBe(true);
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('claim_square', {
			p_party_id: 'test-party-id',
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});
	});

	it('returns false on RPC error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'Already claimed' },
		});
		const result = await claimSquare(0, 0);
		expect(result).toBe(false);
	});
});

describe('claimSquaresBatch (legacy)', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('returns 0 when no party loaded', async () => {
		const result = await claimSquaresBatch([{ row: 0, col: 0 }]);
		expect(result).toBe(0);
	});

	it('returns 0 when cells array is empty', async () => {
		party.set(createMockParty());
		const result = await claimSquaresBatch([]);
		expect(result).toBe(0);
	});

	it('returns 0 when party status is not filling', async () => {
		party.set(createMockParty({ status: 'active' }));
		const result = await claimSquaresBatch([{ row: 0, col: 0 }]);
		expect(result).toBe(0);
	});

	it('returns claimed count on success', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 3, error: null });
		const result = await claimSquaresBatch([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 },
		]);
		expect(result).toBe(3);
	});

	it('returns 0 on RPC error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'Error' },
		});
		const result = await claimSquaresBatch([{ row: 0, col: 0 }]);
		expect(result).toBe(0);
	});
});

describe('unclaimSquare (legacy)', () => {
	beforeEach(() => {
		cleanup();
		userName.setName('Alice');
	});

	it('returns false when no party loaded', async () => {
		const result = await unclaimSquare(0, 0);
		expect(result).toBe(false);
	});

	it('returns false when no user name', async () => {
		await userName.clear();
		party.set(createMockParty());
		const result = await unclaimSquare(0, 0);
		expect(result).toBe(false);
	});

	it('returns false when party status is not filling', async () => {
		party.set(createMockParty({ status: 'active' }));
		const result = await unclaimSquare(0, 0);
		expect(result).toBe(false);
	});

	it('returns true on RPC success', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
		const result = await unclaimSquare(0, 0);
		expect(result).toBe(true);
	});

	it('returns false on RPC error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'Error' },
		});
		const result = await unclaimSquare(0, 0);
		expect(result).toBe(false);
	});
});
