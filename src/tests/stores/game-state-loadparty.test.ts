import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	loadParty,
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	gameHomeIsRow,
	liveScores,
	isLoading,
	error,
	cleanup,
} from '$lib/stores/game';
import { mockSupabaseClient } from '../setup';
import {
	createEmptyGrid,
	createMockGameScores,
	createMockNumbers,
	createMockParty,
	createMockScores,
	createMockWinner,
} from '../factories';

// loadParty reads everything through one get_party_state call (migration 039).

function stateResponds(overrides: Record<string, unknown> = {}) {
	mockSupabaseClient.rpc.mockResolvedValueOnce({
		data: {
			party: createMockParty({ status: 'active' }),
			squares: createEmptyGrid(),
			numbers: createMockNumbers(),
			scores: createMockScores(),
			winners: [createMockWinner()],
			game: null,
			...overrides,
		},
		error: null,
	});
}

describe('loadParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('fills every party store from one read', async () => {
		stateResponds();

		expect(await loadParty('test123')).toBe(true);

		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_party_state', { p_code: 'test123' });
		expect(get(party)?.status).toBe('active');
		expect(get(squares)).toHaveLength(100);
		expect(get(numbers)).not.toBeNull();
		expect(get(scores)).not.toBeNull();
		expect(get(winners)).toHaveLength(1);
		expect(get(gameScores)).toBeNull();
		expect(get(isLoading)).toBe(false);
		expect(get(error)).toBeNull();
	});

	it('reports a missing party', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: null });

		expect(await loadParty('NOPE00')).toBe(false);

		expect(get(error)).toBe('Party not found');
		expect(get(isLoading)).toBe(false);
	});

	it('reports a failed read instead of showing an empty grid', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'TypeError: Failed to fetch' },
		});

		expect(await loadParty('test123')).toBe(false);

		expect(get(error)).toBe("Couldn't load that party. Check your connection and try again.");
		expect(get(squares)).toEqual([]);
	});

	it('reports a load that throws instead of hanging on the spinner', async () => {
		mockSupabaseClient.rpc.mockRejectedValueOnce(new Error('boom'));

		expect(await loadParty('test123')).toBe(false);

		expect(get(isLoading)).toBe(false);
		expect(get(error)).toBe("Couldn't load that party. Check your connection and try again.");
	});

	it('drops invalid rows rather than the whole party', async () => {
		const grid = createEmptyGrid();
		stateResponds({ squares: [...grid.slice(0, 99), { id: 'broken' }], numbers: { bad: true } });

		expect(await loadParty('test123')).toBe(true);

		expect(get(squares)).toHaveLength(99);
		expect(get(numbers)).toBeNull();
	});

	it('shows the live game with the side the server worked out', async () => {
		stateResponds({
			game: {
				row: createMockGameScores({ home_score: 14, away_score: 7 }),
				home_is_row: false,
				linked: false,
			},
		});

		await loadParty('test123');

		expect(get(gameHomeIsRow)).toBe(false);
		expect(get(liveScores)).toMatchObject({ rowScore: 7, colScore: 14 });
		// An unlinked game is display-only: the party keeps its real (null) link.
		expect(get(party)?.game_id).toBeNull();
	});
});
