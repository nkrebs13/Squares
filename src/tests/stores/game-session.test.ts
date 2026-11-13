import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	gameHomeIsRow,
	isLoading,
	error,
	selectedPlayerFilter,
} from '$lib/stores/game-state';
import { pendingOperations } from '$lib/stores/game-pending';
import {
	createEmptyGrid,
	createMockGameScores,
	createMockNumbers,
	createMockParty,
	createMockScores,
	createMockWinner,
} from '../factories';

const { loadParty, subscribeToParty } = vi.hoisted(() => ({
	loadParty: vi.fn(),
	subscribeToParty: vi.fn(),
}));

vi.mock('$lib/stores/game-load', () => ({ loadParty }));
vi.mock('$lib/stores/game-realtime', async (importOriginal) => ({
	...((await importOriginal()) as Record<string, unknown>),
	subscribeToParty,
}));

import { openParty, cleanup } from '$lib/stores/game-session';

/** loadParty stand-in that fills the stores the way a successful load does. */
function loadsParty(gameId: string | null, detectedGameId: string | null = null) {
	loadParty.mockImplementation(async () => {
		party.set(createMockParty({ id: 'p1', game_id: gameId }));
		gameScores.set(detectedGameId ? ({ game_id: detectedGameId } as never) : null);
		return true;
	});
}

describe('openParty', () => {
	beforeEach(() => {
		party.set(null);
		gameScores.set(null);
	});

	it('follows the party and its linked game', async () => {
		loadsParty('g-linked', 'g-detected');
		expect(await openParty('ABC123')).toBe(true);
		expect(loadParty).toHaveBeenCalledWith('ABC123', expect.any(Function));
		expect(subscribeToParty).toHaveBeenCalledWith('p1', 'g-linked', expect.any(Function));
	});

	it('follows a detected game when none is linked', async () => {
		loadsParty(null, 'g-detected');
		await openParty('ABC123');
		expect(subscribeToParty).toHaveBeenCalledWith('p1', 'g-detected', expect.any(Function));
	});

	it('follows the party alone when there is no game', async () => {
		loadsParty(null);
		await openParty('ABC123');
		expect(subscribeToParty).toHaveBeenCalledWith('p1', null, expect.any(Function));
	});

	it('subscribes to nothing when the party cannot be loaded', async () => {
		loadParty.mockResolvedValue(false);
		expect(await openParty('NOPE00')).toBe(false);
		expect(subscribeToParty).not.toHaveBeenCalled();
	});
});

describe('openParty when the party is left mid-load', () => {
	function deferredLoad() {
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		loadParty.mockImplementation(async (_code: string, isCurrent: () => boolean) => {
			await gate;
			if (!isCurrent()) return false;
			party.set(createMockParty({ id: 'late' }));
			return true;
		});
		return release;
	}

	beforeEach(() => {
		party.set(null);
		subscribeToParty.mockClear();
	});

	it('leaves no state and no subscription behind after cleanup', async () => {
		const release = deferredLoad();
		const opening = openParty('ABC123');
		cleanup();
		release();
		expect(await opening).toBe(false);
		expect(get(party)).toBeNull();
		expect(subscribeToParty).not.toHaveBeenCalled();
	});

	it('lets a newer open win over an older one still loading', async () => {
		const releaseFirst = deferredLoad();
		const first = openParty('OLD111');
		loadsParty('g-new');
		expect(await openParty('NEW222')).toBe(true);
		releaseFirst();
		expect(await first).toBe(false);
		expect(subscribeToParty).toHaveBeenCalledTimes(1);
		expect(subscribeToParty).toHaveBeenCalledWith('p1', 'g-new', expect.any(Function));
	});
});

describe('cleanup (leaving a party)', () => {
	it('resets all stores to initial state', () => {
		party.set(createMockParty());
		squares.set(createEmptyGrid());
		numbers.set(createMockNumbers());
		scores.set(createMockScores());
		winners.set([createMockWinner()]);
		gameScores.set(createMockGameScores());
		error.set('Some error');
		isLoading.set(false);
		gameHomeIsRow.set(false);
		selectedPlayerFilter.set('alice');
		pendingOperations.set(
			new Map([
				[
					'0-0',
					{
						clientId: 'test-client',
						origin: 'local',
						type: 'claim',
						row: 0,
						col: 0,
						timestamp: Date.now(),
						originalState: { player_name: null, player_name_lower: null, claimed_at: null },
					},
				],
			])
		);

		cleanup();

		expect(get(party)).toBeNull();
		expect(get(squares)).toEqual([]);
		expect(get(numbers)).toBeNull();
		expect(get(scores)).toBeNull();
		expect(get(winners)).toEqual([]);
		expect(get(gameScores)).toBeNull();
		expect(get(isLoading)).toBe(true);
		expect(get(gameHomeIsRow)).toBe(true);
		expect(get(error)).toBeNull();
		expect(get(selectedPlayerFilter)).toBeNull();
		expect(get(pendingOperations).size).toBe(0);
	});
});
