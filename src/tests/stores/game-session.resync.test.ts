import { describe, it, expect, vi, beforeEach } from 'vitest';
import { get, type Writable } from 'svelte/store';
import { party, squares, isLoading, error } from '$lib/stores/game-state';
import { pendingOperations, addPendingOps, newPendingOp } from '$lib/stores/game-pending';
import { mockSupabaseClient } from '../setup';
import { createEmptyGrid, createMockParty } from '../factories';

type Connection = { status: string; attempt: number };
const hoisted = vi.hoisted(() => ({ store: null as unknown }));

vi.mock('$lib/stores/game-realtime', async () => {
	const { writable } = await import('svelte/store');
	const store = writable({ status: 'connected', attempt: 0 });
	hoisted.store = store;
	return { connectionStatus: store, subscribeToParty: vi.fn(), cleanupChannels: vi.fn() };
});

import { openParty, cleanup } from '$lib/stores/game-session';
import { subscribeToParty } from '$lib/stores/game-realtime';

const connection = () => hoisted.store as Writable<Connection>;

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

describe('resync after a reconnect', () => {
	beforeEach(async () => {
		cleanup();
		connection().set({ status: 'connected', attempt: 0 });
		mockSupabaseClient.rpc.mockReset();
		stateResponds();
		await openParty('ABC123');
	});

	it('does not refresh on the initial connect', async () => {
		await flush();
		expect(stateCalls()).toBe(1);
	});

	it('refreshes once when reconnecting returns to connected, without toggling isLoading', async () => {
		const loadingSeen: boolean[] = [];
		const unsubscribe = isLoading.subscribe((v) => loadingSeen.push(v));
		loadingSeen.length = 0;

		connection().set({ status: 'reconnecting', attempt: 1 });
		connection().set({ status: 'reconnecting', attempt: 2 });
		stateResponds({ status: 'active', claimedCell: [2, 3] });
		connection().set({ status: 'connected', attempt: 0 });
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

		connection().set({ status: 'reconnecting', attempt: 1 });
		connection().set({ status: 'connected', attempt: 0 });
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
		connection().set({ status: 'reconnecting', attempt: 1 });
		connection().set({ status: 'connected', attempt: 0 });
		await flush();

		expect(stateCalls()).toBe(2);
		expect(get(party)?.status).toBe('active');
	});

	it('a newer refresh wins when an older one answers last', async () => {
		let answerOld!: (value: unknown) => void;
		mockSupabaseClient.rpc.mockReturnValueOnce(new Promise((r) => (answerOld = r)) as never);
		connection().set({ status: 'reconnecting', attempt: 1 });
		connection().set({ status: 'connected', attempt: 0 });

		stateResponds({ status: 'complete' });
		connection().set({ status: 'reconnecting', attempt: 1 });
		connection().set({ status: 'connected', attempt: 0 });
		await flush();
		expect(get(party)?.status).toBe('complete');

		answerOld({
			data: {
				party: createMockParty({ id: 'p1', status: 'filling' }),
				squares: createEmptyGrid(),
				numbers: null,
				scores: null,
				winners: [],
				game: null,
			},
			error: null,
		});
		await flush();
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

	it('also refreshes after the connection had failed', async () => {
		connection().set({ status: 'failed', attempt: 5 });
		stateResponds();
		connection().set({ status: 'connected', attempt: 0 });
		await flush();
		expect(stateCalls()).toBe(2);
	});

	it('ends pending ops when fresh rows replace the grid', async () => {
		addPendingOps([newPendingOp('claim', get(squares)[0], Date.now())]);
		connection().set({ status: 'reconnecting', attempt: 1 });
		stateResponds();
		connection().set({ status: 'connected', attempt: 0 });
		await flush();
		expect(get(pendingOperations).size).toBe(0);
	});

	it('does not refresh after cleanup', async () => {
		cleanup();
		connection().set({ status: 'reconnecting', attempt: 1 });
		connection().set({ status: 'connected', attempt: 0 });
		await flush();
		expect(stateCalls()).toBe(1);
	});

	it('keeps the current state when the refresh fails', async () => {
		const before = get(squares);
		connection().set({ status: 'reconnecting', attempt: 1 });
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'down' } });
		connection().set({ status: 'connected', attempt: 0 });
		await flush();
		expect(stateCalls()).toBe(2);
		expect(get(squares)).toBe(before);
		expect(get(party)?.status).toBe('filling');
		expect(get(isLoading)).toBe(false);
		expect(get(error)).toBeNull();
	});
});

describe('following a game linked while the party is open', () => {
	beforeEach(async () => {
		cleanup();
		connection().set({ status: 'connected', attempt: 0 });
		mockSupabaseClient.rpc.mockReset();
		vi.mocked(subscribeToParty).mockClear();
		stateResponds();
		await openParty('ABC123');
	});

	it("subscribes the game's channel when the party gains a game", () => {
		expect(vi.mocked(subscribeToParty)).toHaveBeenLastCalledWith('p1', null);
		stateResponds();
		party.update((p) => (p ? { ...p, game_id: 'g1' } : p));
		expect(vi.mocked(subscribeToParty)).toHaveBeenLastCalledWith('p1', 'g1');
		expect(vi.mocked(subscribeToParty)).toHaveBeenCalledTimes(2);
	});

	it('re-reads the party once after following a newly linked game', async () => {
		stateResponds();
		party.update((p) => (p ? { ...p, game_id: 'g1' } : p));
		await flush();
		expect(stateCalls()).toBe(2);
	});

	it('does not resubscribe for other changes to the same party', () => {
		party.update((p) => (p ? { ...p, game_id: 'g1' } : p));
		party.update((p) => (p ? { ...p, event_name: 'Renamed' } : p));
		expect(vi.mocked(subscribeToParty)).toHaveBeenCalledTimes(2);
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

	it('stops following after the party is left', () => {
		cleanup();
		party.set(createMockParty({ id: 'p1', game_id: 'g9' }));
		expect(vi.mocked(subscribeToParty)).toHaveBeenCalledTimes(1);
	});
});
