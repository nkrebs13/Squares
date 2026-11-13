import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { party, squares, isLoading, error, gameScores } from '$lib/stores/game-state';
import {
	pendingOperations,
	addPendingOps,
	newPendingOp,
	applySquareUpdate,
} from '$lib/stores/game-pending';
import { mockSupabaseClient } from '../setup';
import { createEmptyGrid, createMockGameScores, createMockParty } from '../factories';

vi.mock('$lib/stores/game-realtime', () => ({
	subscribeToParty: vi.fn(),
	followGame: vi.fn(),
	cleanupChannels: vi.fn(),
}));

import { openParty, cleanup, PARTY_REFRESH_MS } from '$lib/stores/game-session';
import { removePlayer } from '$lib/stores/game-admin';
import { followGame, subscribeToParty } from '$lib/stores/game-realtime';

/** The party channel (re)joining: what subscribeToParty's callback reports. */
const partyChannelJoins = () => vi.mocked(subscribeToParty).mock.lastCall?.[2]?.();

function stateResponds(opts: { status?: string; claimedCell?: [number, number] } = {}) {
	const cell = opts.claimedCell;
	const grid = createEmptyGrid().map((s) =>
		cell && s.row_num === cell[0] && s.col_num === cell[1]
			? { ...s, player_name: 'Ann', player_name_lower: 'ann', claimed_at: '2026-01-01T00:00:00Z' }
			: s
	);
	mockSupabaseClient.rpc.mockResolvedValueOnce({
		data: {
			party: createMockParty({ id: 'p1', status: (opts.status ?? 'filling') as never }),
			squares: grid,
			numbers: null,
			scores: null,
			winners: [],
			game: null,
		},
		error: null,
	});
}

const stateCalls = () =>
	mockSupabaseClient.rpc.mock.calls.filter(([name]) => name === 'get_party_state').length;

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('re-read when the party channel joins', () => {
	beforeEach(async () => {
		cleanup();
		mockSupabaseClient.rpc.mockReset();
		stateResponds();
		await openParty('ABC123');
	});

	it('re-reads once when the party channel first joins, closing the load-to-subscribe gap', async () => {
		await flush();
		expect(stateCalls()).toBe(1);
		stateResponds({ claimedCell: [4, 4] });
		partyChannelJoins();
		await flush();
		expect(stateCalls()).toBe(2);
		expect(get(squares).find((s) => s.row_num === 4 && s.col_num === 4)?.player_name).toBe('Ann');
	});

	it('refreshes on a rejoin after a gap, without toggling isLoading', async () => {
		const loadingSeen: boolean[] = [];
		const unsubscribe = isLoading.subscribe((v) => loadingSeen.push(v));
		loadingSeen.length = 0;

		stateResponds({ status: 'active', claimedCell: [2, 3] });
		partyChannelJoins();
		await flush();
		unsubscribe();

		expect(stateCalls()).toBe(2);
		expect(get(party)?.status).toBe('active');
		expect(get(squares).find((s) => s.row_num === 2 && s.col_num === 3)?.player_name).toBe('Ann');
		expect(loadingSeen).toEqual([]);
		expect(get(error)).toBeNull();
	});

	it('drops a refresh still in flight when the party is left', async () => {
		let respond!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (respond = r)) as never);

		partyChannelJoins();
		cleanup();
		// A claim started after leaving belongs to whatever comes next; the stale refresh must not end it.
		addPendingOps([newPendingOp('claim', createEmptyGrid()[1], Date.now())]);
		respond({
			data: {
				party: createMockParty({ id: 'p1', status: 'active' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await flush();

		expect(get(party)).toBeNull();
		expect(get(pendingOperations).has('0-1')).toBe(true);
	});

	it('skips a refresh snapshot that is a stage behind what is shown', async () => {
		party.update((p) => (p ? { ...p, status: 'active' } : p));
		stateResponds({ status: 'filling' });
		partyChannelJoins();
		await flush();

		expect(stateCalls()).toBe(2);
		expect(get(party)?.status).toBe('active');
	});

	it('marks the party not found when a refresh finds it deleted', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: null });
		partyChannelJoins();
		await flush();

		expect(get(error)).toBe('Party not found');
	});

	it('a trigger while a read is out runs one more read after it, and that one lands', async () => {
		let answerFirst!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (answerFirst = r)) as never);
		partyChannelJoins();
		partyChannelJoins(); // queued, not a second read in parallel
		partyChannelJoins(); // still just one more
		expect(stateCalls()).toBe(2);

		stateResponds({ status: 'complete' });
		answerFirst({
			data: {
				party: createMockParty({ id: 'p1', status: 'active' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await flush();
		await flush();

		expect(stateCalls()).toBe(3);
		expect(get(party)?.status).toBe('complete');
	});

	it('a party left just after its load returned is not restored or subscribed', async () => {
		cleanup();
		const subscribed = vi.mocked(subscribeToParty).mock.calls.length;
		let answer!: (value: unknown) => void;
		const pending = new Promise((r) => (answer = r));
		mockSupabaseClient.rpc.mockReturnValueOnce(pending as never);

		const opening = openParty('ABC123');
		// Runs after loadParty's fetch has checked isCurrent, before the result is applied.
		void pending.then(() => cleanup());
		answer({
			data: {
				party: createMockParty({ id: 'p1' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});

		expect(await opening).toBe(false);
		expect(get(party)).toBeNull();
		expect(vi.mocked(subscribeToParty).mock.calls.length).toBe(subscribed);
	});

	it('does not re-read while a claim is in flight', async () => {
		addPendingOps([newPendingOp('claim', get(squares)[0], Date.now())]);
		partyChannelJoins();
		await flush();
		expect(stateCalls()).toBe(1);
		expect(get(pendingOperations).size).toBe(1);
	});

	it('a claim made while a read is out is not undone by its older snapshot', async () => {
		let answer!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (answer = r)) as never);
		partyChannelJoins();

		// The user claims 0-0 while the read is out (begin: op added, square drawn).
		const square = get(squares)[0];
		addPendingOps([newPendingOp('claim', square, Date.now())]);
		squares.update((all) =>
			all.map((s) =>
				s.id === square.id ? { ...s, player_name: 'Me', player_name_lower: 'me' } : s
			)
		);
		answer({
			data: {
				party: createMockParty({ id: 'p1' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await flush();

		expect(get(squares)[0].player_name).toBe('Me');
		expect(get(pendingOperations).size).toBe(1);
	});

	it("a host's removal applied while a read is out is not undone by it", async () => {
		squares.update((all) =>
			all.map((sq, i) =>
				i === 3 ? { ...sq, player_name: 'Alice', player_name_lower: 'alice' } : sq
			)
		);
		let answer!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (answer = r)) as never);
		partyChannelJoins();
		const withAlice = get(squares);

		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { ok: true, removed: 1 }, error: null });
		expect((await removePlayer('1234', 'alice')).success).toBe(true);
		answer({
			data: {
				party: createMockParty({ id: 'p1' }),
				squares: withAlice,
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await flush();

		expect(get(squares)[3].player_name).toBeNull();
	});

	it('a Realtime row applied while a read is out is not overwritten by it', async () => {
		let answer!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (answer = r)) as never);
		partyChannelJoins();

		applySquareUpdate({ ...get(squares)[5], player_name: 'Bob', player_name_lower: 'bob' });
		answer({
			data: {
				party: createMockParty({ id: 'p1' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await flush();

		expect(get(squares)[5].player_name).toBe('Bob');
	});

	it('does not refresh after cleanup', async () => {
		cleanup();
		partyChannelJoins();
		await flush();
		expect(stateCalls()).toBe(1);
	});

	it('keeps the current state when the refresh fails', async () => {
		const before = get(squares);
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
		partyChannelJoins();
		await flush();
		expect(stateCalls()).toBe(2);
		expect(get(squares)).toBe(before);
		expect(get(party)?.status).toBe('filling');
		expect(get(isLoading)).toBe(false);
		expect(get(error)).toBeNull();
	});
});

describe("following the party's game while it is open", () => {
	beforeEach(async () => {
		cleanup();
		mockSupabaseClient.rpc.mockReset();
		vi.mocked(subscribeToParty).mockClear();
		vi.mocked(followGame).mockClear();
		stateResponds();
		await openParty('ABC123');
	});

	it("re-keys only the game's channel when the party gains a game, leaving the party's joined", () => {
		expect(vi.mocked(subscribeToParty)).toHaveBeenLastCalledWith('p1', null, expect.any(Function));
		stateResponds();
		party.update((p) => (p ? { ...p, game_id: 'g1' } : p));
		expect(vi.mocked(followGame)).toHaveBeenCalledWith('g1');
		expect(vi.mocked(followGame)).toHaveBeenCalledTimes(1);
		expect(vi.mocked(subscribeToParty)).toHaveBeenCalledTimes(1);
	});

	it('re-reads the party once after following a newly linked game, to fetch its row', async () => {
		stateResponds();
		party.update((p) => (p ? { ...p, game_id: 'g1' } : p));
		await flush();
		expect(stateCalls()).toBe(2);
	});

	it('does not re-key for other changes to the same party', () => {
		party.update((p) => (p ? { ...p, game_id: 'g1' } : p));
		party.update((p) => (p ? { ...p, event_name: 'Renamed' } : p));
		expect(vi.mocked(followGame)).toHaveBeenCalledTimes(1);
	});

	it('re-reads an unlinked party when its team names change (its game is detected by name)', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: {
				party: createMockParty({ id: 'p1', team_row_name: 'Ravens', team_col_name: 'Lions' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		party.update((p) => (p ? { ...p, team_row_name: 'Ravens', team_col_name: 'Lions' } : p));
		await flush();
		expect(stateCalls()).toBe(2);

		party.update((p) => (p ? { ...p, event_name: 'Renamed' } : p));
		await flush();
		expect(stateCalls()).toBe(2);
	});

	it("an unlinked party's game channel follows the game a re-read detects, and drops it when none matches", async () => {
		const renamedTo = (row: string, col: string, game: string | null) => {
			mockSupabaseClient.rpc.mockResolvedValueOnce({
				data: {
					party: createMockParty({ id: 'p1', team_row_name: row, team_col_name: col }),
					squares: createEmptyGrid(),
					numbers: null,
					scores: null,
					winners: [],
					game: game
						? { row: createMockGameScores({ game_id: game }), home_is_row: true, linked: false }
						: null,
				},
				error: null,
			});
			party.update((p) => (p ? { ...p, team_row_name: row, team_col_name: col } : p));
		};

		renamedTo('Ravens', 'Lions', 'g2');
		await flush();
		expect(get(gameScores)?.game_id).toBe('g2');
		expect(vi.mocked(followGame)).toHaveBeenLastCalledWith('g2');

		renamedTo('Jets', 'Bills', null);
		await flush();
		expect(get(gameScores)).toBeNull();
		expect(vi.mocked(followGame)).toHaveBeenLastCalledWith(null);
		expect(vi.mocked(followGame)).toHaveBeenCalledTimes(2);
		// One read per rename: following a detected game needs no extra read.
		expect(stateCalls()).toBe(3);
		expect(vi.mocked(subscribeToParty)).toHaveBeenCalledTimes(1);
	});

	it('does not re-key when a read or a live update keeps the same detected game', () => {
		gameScores.set(createMockGameScores({ game_id: 'g2' }));
		gameScores.set(createMockGameScores({ game_id: 'g2', home_score: 7 }));
		expect(vi.mocked(followGame)).toHaveBeenCalledTimes(1);
	});

	it('stops following after the party is left', () => {
		cleanup();
		party.set(createMockParty({ id: 'p1', game_id: 'g9' }));
		gameScores.set(createMockGameScores({ game_id: 'g9' }));
		expect(vi.mocked(followGame)).not.toHaveBeenCalled();
		expect(vi.mocked(subscribeToParty)).toHaveBeenCalledTimes(1);
	});
});

describe('re-read while the page is looked at', () => {
	beforeEach(async () => {
		vi.useFakeTimers();
		cleanup();
		mockSupabaseClient.rpc.mockReset();
		stateResponds();
		await openParty('ABC123');
		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
	});

	afterEach(() => {
		cleanup();
		vi.useRealTimers();
	});

	it('re-reads every minute while visible, with nothing from Realtime', async () => {
		stateResponds({ status: 'active' });
		await vi.advanceTimersByTimeAsync(PARTY_REFRESH_MS);
		expect(stateCalls()).toBe(2);
		expect(get(party)?.status).toBe('active');
	});

	it('does not re-read while hidden, and re-reads as soon as the page is shown again', async () => {
		Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
		await vi.advanceTimersByTimeAsync(PARTY_REFRESH_MS * 3);
		expect(stateCalls()).toBe(1);

		Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
		stateResponds();
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(stateCalls()).toBe(2);
	});

	it('reads slower than the poll still land', async () => {
		let answer!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (answer = r)) as never);
		await vi.advanceTimersByTimeAsync(PARTY_REFRESH_MS); // read 1 goes out
		stateResponds({ status: 'complete' });
		await vi.advanceTimersByTimeAsync(PARTY_REFRESH_MS); // poll while it is out: queued
		expect(stateCalls()).toBe(2);

		answer({
			data: {
				party: createMockParty({ id: 'p1', status: 'active' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await vi.advanceTimersByTimeAsync(0);
		expect(stateCalls()).toBe(3);
		expect(get(party)?.status).toBe('complete');
	});

	it('waits while a claim is in flight', async () => {
		addPendingOps([newPendingOp('claim', get(squares)[0], Date.now())]);
		await vi.advanceTimersByTimeAsync(PARTY_REFRESH_MS - 1);
		expect(stateCalls()).toBe(1);
	});

	it('stops once the party is left', async () => {
		cleanup();
		await vi.advanceTimersByTimeAsync(PARTY_REFRESH_MS * 2);
		expect(stateCalls()).toBe(1);
	});
});
