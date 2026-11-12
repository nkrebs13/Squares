/**
 * What the realtime channels deliver into the stores: postgres_changes rows and
 * broadcasts from other tabs. Handlers are fetched by event and table from the
 * channel mock; channel lifecycle is in game-realtime.channels.test.ts.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import {
	subscribeToParty,
	claimSquareOptimistic,
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	pendingOperations,
	cleanup,
	error,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { BroadcastMessage } from '$lib/types';
import { channelHandler, mockSupabaseClient, rpcHangs } from '../setup';
import {
	createMockGameScores,
	createMockNumbers,
	createMockParty,
	createMockScores,
	createMockSquare,
	createMockWinner,
} from '../factories';

/** A browser tab other than ours; our own id is 'test-uuid-1234' (the crypto mock). */
const REMOTE = 'remote-client-123';

function open(gameId: string | null = null) {
	subscribeToParty('test-party-id', gameId);
}

/** Deliver a postgres_changes payload to the handler of `table`. */
function pgChange(table: string, payload: { eventType: string; new?: unknown; old?: unknown }) {
	channelHandler('postgres_changes', table)(payload);
}

/** Deliver a square_update broadcast from another tab (or `clientId`). */
function squareBroadcast(
	type: BroadcastMessage['type'],
	squareKey: string,
	playerName: string,
	clientId = REMOTE
) {
	channelHandler(
		'broadcast',
		'square_update'
	)({
		payload: { type, squareKey, playerName, timestamp: Date.now(), clientId },
	});
}

function bobHoldsFirstSquare() {
	return createMockSquare(0, 0, {
		player_name: 'Bob',
		player_name_lower: 'bob',
		claimed_at: '2024-01-01T00:00:00Z',
	});
}

beforeEach(() => {
	cleanup();
	userName.setName('Alice');
});

describe('postgres_changes: parties', () => {
	it('UPDATE sets party store on filling→active transition', () => {
		party.set(createMockParty({ status: 'filling' }));
		open();

		pgChange('parties', { eventType: 'UPDATE', new: createMockParty({ status: 'active' }) });

		expect(get(party)?.status).toBe('active');
	});

	it('UPDATE sets party store on active→complete transition', () => {
		party.set(createMockParty({ status: 'active' }));
		open();

		pgChange('parties', { eventType: 'UPDATE', new: createMockParty({ status: 'complete' }) });

		expect(get(party)?.status).toBe('complete');
	});

	it('ignores an older row image that would move the party back a stage', () => {
		// The PIN check's pin_attempts reset is an UPDATE that still carries the old status.
		party.set(createMockParty({ status: 'active' }));
		open();

		pgChange('parties', { eventType: 'UPDATE', new: createMockParty({ status: 'filling' }) });

		expect(get(party)?.status).toBe('active');
	});

	it('applies an earlier-stage UPDATE for a different party than the one shown', () => {
		// A late host-action result for another party must not block this party's rows.
		party.set(createMockParty({ id: 'party-a', status: 'active' }));
		open();

		pgChange('parties', {
			eventType: 'UPDATE',
			new: createMockParty({ id: 'party-b', status: 'filling' }),
		});

		expect(get(party)).toMatchObject({ id: 'party-b', status: 'filling' });
	});

	it('applies an UPDATE within the same stage (e.g. edited details while filling)', () => {
		party.set(createMockParty({ status: 'filling', event_name: 'Old' }));
		open();

		pgChange('parties', {
			eventType: 'UPDATE',
			new: createMockParty({ status: 'filling', event_name: 'New' }),
		});

		expect(get(party)?.event_name).toBe('New');
	});

	it('marks the open party not found when it is deleted', () => {
		party.set(createMockParty({ id: 'party-a' }));
		open();

		pgChange('parties', { eventType: 'DELETE', old: { id: 'party-a' } });

		expect(get(error)).toBe('Party not found');
	});

	it('ignores the deletion of a different party', () => {
		party.set(createMockParty({ id: 'party-a' }));
		error.set(null);
		open();

		pgChange('parties', { eventType: 'DELETE', old: { id: 'party-b' } });

		expect(get(error)).toBeNull();
	});

	it('ignores non-UPDATE events', () => {
		party.set(createMockParty({ status: 'filling' }));
		open();

		pgChange('parties', { eventType: 'INSERT', new: createMockParty({ status: 'active' }) });

		expect(get(party)?.status).toBe('filling');
	});
});

describe('postgres_changes: numbers', () => {
	it('INSERT sets numbers store', () => {
		open();
		expect(get(numbers)).toBeNull();

		const newNumbers = createMockNumbers({
			row_numbers: [3, 7, 1, 9, 0, 5, 8, 2, 6, 4],
			col_numbers: [6, 2, 8, 0, 4, 1, 9, 5, 3, 7],
		});
		pgChange('numbers', { eventType: 'INSERT', new: newNumbers });

		expect(get(numbers)).toEqual(newNumbers);
	});

	it('UPDATE replaces numbers store', () => {
		numbers.set(createMockNumbers());
		open();

		const updated = createMockNumbers({
			row_numbers: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
			col_numbers: [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
		});
		pgChange('numbers', { eventType: 'UPDATE', new: updated });

		expect(get(numbers)).toEqual(updated);
	});

	it('ignores DELETE events', () => {
		const initial = createMockNumbers();
		numbers.set(initial);
		open();

		pgChange('numbers', { eventType: 'DELETE', old: initial });

		expect(get(numbers)).toEqual(initial);
	});
});

describe('postgres_changes: scores', () => {
	it('INSERT sets scores store', () => {
		open();
		expect(get(scores)).toBeNull();

		const newScores = createMockScores({ q1_row_score: 7, q1_col_score: 3 });
		pgChange('scores', { eventType: 'INSERT', new: newScores });

		expect(get(scores)).toEqual(newScores);
	});

	it('UPDATE replaces scores store', () => {
		const initial = createMockScores({ q1_row_score: 7, q1_col_score: 3 });
		scores.set(initial);
		open();

		const updated = { ...initial, q2_row_score: 14, q2_col_score: 10 };
		pgChange('scores', { eventType: 'UPDATE', new: updated });

		expect(get(scores)).toEqual(updated);
	});
});

describe('postgres_changes: winners', () => {
	const q1 = createMockWinner({ id: 'winner-1', quarter: 'q1', player_name: 'Alice' });
	const q2 = createMockWinner({ id: 'winner-2', quarter: 'q2', player_name: 'Bob' });
	const q3 = createMockWinner({ id: 'winner-3', quarter: 'q3', player_name: 'Alice' });

	it('multiple INSERTs accumulate correctly', () => {
		winners.set([]);
		open();

		pgChange('winners', { eventType: 'INSERT', new: q1 });
		pgChange('winners', { eventType: 'INSERT', new: q2 });
		pgChange('winners', { eventType: 'INSERT', new: q3 });

		expect(get(winners)).toEqual([q1, q2, q3]);
	});

	it('INSERT appends to existing winners', () => {
		winners.set([q1]);
		open();

		pgChange('winners', { eventType: 'INSERT', new: q2 });

		expect(get(winners)).toEqual([q1, q2]);
	});

	it('keeps one winner per quarter when the INSERT lands after a refetch already added it', () => {
		// The score_update broadcast refetches the full winners list; the row's own
		// INSERT can arrive afterwards. A duplicate would crash the keyed winners list.
		winners.set([q1]);
		open();

		pgChange('winners', { eventType: 'INSERT', new: q1 });

		expect(get(winners)).toEqual([q1]);
	});

	it('UPDATE replaces matching winner by party_id and quarter', () => {
		winners.set([q1]);
		open();

		pgChange('winners', { eventType: 'UPDATE', new: { ...q1, player_name: 'Bob', amount: 300 } });

		expect(get(winners)).toHaveLength(1);
		expect(get(winners)[0]).toMatchObject({ player_name: 'Bob', amount: 300 });
	});

	it('UPDATE keeps the winner in its place', () => {
		winners.set([q1, q3]);
		open();

		pgChange('winners', { eventType: 'UPDATE', new: { ...q1, amount: 300 } });

		expect(get(winners).map((w) => w.quarter)).toEqual(['q1', 'q3']);
	});
});

describe('postgres_changes: squares', () => {
	it('UPDATE from postgres_changes replaces optimistic value and clears pending', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();
		rpcHangs();

		claimSquareOptimistic(0, 0);
		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);

		pgChange('squares', {
			eventType: 'UPDATE',
			new: createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
				claimed_at: '2024-02-01T00:00:00Z',
			}),
		});

		expect(get(pendingOperations).has('0-0')).toBe(false);
		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(squares)[0].claimed_at).toBe('2024-02-01T00:00:00Z');
	});
});

describe('postgres_changes: game_scores', () => {
	// A linked game: the party's side of the game decides which score is the row's.
	const liveGame = (overrides = {}) =>
		createMockGameScores({
			game_id: 'game-123',
			home_score: 14,
			away_score: 7,
			game_clock: '5:30',
			game_quarter: 2,
			game_status: 'in_progress',
			...overrides,
		});

	beforeEach(() => {
		party.set(createMockParty({ game_id: 'game-123', home_team_is_row: true }));
	});

	it('INSERT sets gameScores store', () => {
		open('game-123');
		expect(get(gameScores)).toBeNull();

		const inserted = liveGame();
		pgChange('game_scores', { eventType: 'INSERT', new: inserted });

		expect(get(gameScores)).toEqual(inserted);
	});

	it('UPDATE replaces gameScores store', () => {
		gameScores.set(liveGame());
		open('game-123');

		pgChange('game_scores', {
			eventType: 'UPDATE',
			new: liveGame({ home_score: 21, away_score: 14, game_clock: '2:00', game_quarter: 3 }),
		});

		expect(get(gameScores)).toMatchObject({ home_score: 21, away_score: 14, game_quarter: 3 });
	});

	it('DELETE sets gameScores to null', () => {
		const initial = liveGame();
		gameScores.set(initial);
		open('game-123');

		pgChange('game_scores', { eventType: 'DELETE', old: initial });

		expect(get(gameScores)).toBeNull();
	});
});

describe('broadcast square_update: claim_intent', () => {
	it('ignores own clientId broadcasts', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();

		squareBroadcast('claim_intent', '0-0', 'Bob', 'test-uuid-1234');

		expect(get(squares)[0].player_name).toBeNull();
	});

	it('applies optimistic update from remote claim_intent', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();

		squareBroadcast('claim_intent', '0-0', 'Bob');

		expect(get(squares)[0]).toMatchObject({ player_name: 'Bob', player_name_lower: 'bob' });
	});

	it('skips if square is already claimed', () => {
		// Alice's own claim is still in flight when Bob's intent for the same square arrives.
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();
		rpcHangs();
		claimSquareOptimistic(0, 0);

		squareBroadcast('claim_intent', '0-0', 'Bob');

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).get('0-0')).toMatchObject({ origin: 'local', type: 'claim' });
	});

	it('adds remote pending operation', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();

		squareBroadcast('claim_intent', '0-0', 'Bob');

		expect(get(pendingOperations).get('0-0')).toMatchObject({
			origin: 'remote',
			clientId: REMOTE,
			type: 'claim',
		});
	});
});

describe('broadcast square_update: claim_rejected', () => {
	beforeEach(() => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();
	});

	it('rolls back remote pending operation', () => {
		squareBroadcast('claim_intent', '0-0', 'Bob');
		expect(get(squares)[0].player_name).toBe('Bob');

		squareBroadcast('claim_rejected', '0-0', 'Bob');

		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});

	it("does not roll back another client's pending preview", () => {
		squareBroadcast('claim_intent', '0-0', 'Alice', 'alice-client');
		expect(get(squares)[0].player_name).toBe('Alice');

		// Bob's rejection (a different client) must not touch Alice's preview.
		squareBroadcast('claim_rejected', '0-0', 'Bob', 'bob-client');

		expect(get(squares)[0].player_name).toBe('Alice');
		expect(get(pendingOperations).has('0-0')).toBe(true);
	});
});

describe('broadcast square_update: unclaim_intent and unclaim_rejected', () => {
	it('clears square on remote unclaim', () => {
		party.set(createMockParty());
		squares.set([bobHoldsFirstSquare()]);
		open();

		squareBroadcast('unclaim_intent', '0-0', 'Bob');

		expect(get(squares)[0]).toMatchObject({
			player_name: null,
			player_name_lower: null,
			claimed_at: null,
		});
	});

	it('ignores own unclaim broadcasts', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		open();

		squareBroadcast('unclaim_intent', '0-0', 'Alice', 'test-uuid-1234');

		expect(get(squares)[0].player_name).toBe('Alice');
	});

	it('skips if square is already empty', () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0)]);
		open();

		squareBroadcast('unclaim_intent', '0-0', 'Bob');

		expect(get(squares)[0].player_name).toBeNull();
		expect(get(pendingOperations).size).toBe(0);
	});

	it('unclaim_rejected handler restores a square that unclaim_intent cleared', () => {
		party.set(createMockParty());
		squares.set([bobHoldsFirstSquare()]);
		open();

		squareBroadcast('unclaim_intent', '0-0', 'Bob', 'bob-client');
		expect(get(squares)[0].player_name).toBeNull();

		squareBroadcast('unclaim_rejected', '0-0', 'Bob', 'bob-client');

		expect(get(squares)[0]).toMatchObject({
			player_name: 'Bob',
			player_name_lower: 'bob',
			claimed_at: '2024-01-01T00:00:00Z',
		});
		expect(get(pendingOperations).has('0-0')).toBe(false);
	});
});

describe('broadcast score_update', () => {
	const mockScores = createMockScores({ q1_row_score: 14, q1_col_score: 7 });
	const mockWinners = [createMockWinner({ id: 'w1', winning_row: 4, winning_col: 7 })];

	/** Answer the scores read first, then the winners read, like handleScoreUpdateBroadcast makes them. */
	function tablesRespond(
		scoresResult: { data: unknown; error?: unknown },
		winnersResult: { data: unknown; error?: unknown }
	) {
		const results = [scoresResult, winnersResult];
		let call = 0;
		mockSupabaseClient.from.mockImplementation(() => {
			const result = results[call++];
			return {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				single: vi.fn().mockReturnThis(),
				then: vi.fn((cb: (r: { data: unknown; error?: unknown }) => void) => cb(result)),
			};
		});
	}

	function scoreUpdateFrom(clientId: string) {
		channelHandler('broadcast', 'score_update')({ payload: { clientId } });
	}

	it('ignores own score update broadcasts', () => {
		party.set(createMockParty());
		open();

		scoreUpdateFrom('test-uuid-1234');

		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('early returns when party is null', () => {
		party.set(null);
		open();

		scoreUpdateFrom('other-client-id');

		expect(mockSupabaseClient.from).not.toHaveBeenCalled();
	});

	it('drops a refetch that lands after another party was opened', () => {
		// Hold both reads until the test answers them.
		const pending: Array<(r: { data: unknown }) => void> = [];
		mockSupabaseClient.from.mockImplementation(() => ({
			select: vi.fn().mockReturnThis(),
			insert: vi.fn().mockReturnThis(),
			update: vi.fn().mockReturnThis(),
			delete: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			order: vi.fn().mockReturnThis(),
			single: vi.fn().mockReturnThis(),
			then: vi.fn((cb: (r: { data: unknown }) => void) => pending.push(cb)),
		}));
		party.set(createMockParty({ id: 'party-a' }));
		open();
		scoreUpdateFrom('other-client-id');

		const partyB = createMockParty({ id: 'party-b', code: 'BBBB22' });
		party.set(partyB);
		scores.set(null);
		winners.set([]);
		const [answerScores, answerWinners] = pending;
		answerScores({ data: mockScores });
		answerWinners({ data: mockWinners });

		expect(get(scores)).toBeNull();
		expect(get(winners)).toEqual([]);
	});

	it('re-fetches scores and winners on external score update', () => {
		party.set(createMockParty());
		tablesRespond({ data: mockScores }, { data: mockWinners });
		open();

		scoreUpdateFrom('other-client-id');

		expect(mockSupabaseClient.from).toHaveBeenCalledWith('scores');
		expect(mockSupabaseClient.from).toHaveBeenCalledWith('winners');
		expect(get(scores)).toEqual(mockScores);
		expect(get(winners)).toEqual(mockWinners);
	});

	it('logs a warning and leaves the scores store untouched when the scores refetch errors', () => {
		party.set(createMockParty());
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		// Only the scores read fails, so only that branch is exercised.
		tablesRespond({ data: null, error: { message: 'scores fetch failed' } }, { data: [] });
		open();

		scoreUpdateFrom('other-client-id');

		expect(warnSpy).toHaveBeenCalledWith(
			'[realtime] failed to refetch scores after broadcast:',
			'scores fetch failed'
		);
		expect(get(scores)).toBeNull();
		warnSpy.mockRestore();
	});

	it('logs a warning and leaves the winners store untouched when the winners refetch errors', () => {
		party.set(createMockParty());
		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		tablesRespond({ data: mockScores }, { data: null, error: { message: 'winners fetch failed' } });
		open();

		scoreUpdateFrom('other-client-id');

		expect(warnSpy).toHaveBeenCalledWith(
			'[realtime] failed to refetch winners after broadcast:',
			'winners fetch failed'
		);
		expect(get(winners)).toEqual([]);
		// scores DID succeed, confirming only the winners branch failed
		expect(get(scores)).toEqual(mockScores);
		warnSpy.mockRestore();
	});
});
