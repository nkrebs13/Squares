import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	lockParty,
	updateScore,
	updatePartyDetails,
	updatePayoutStructure,
	removePlayer,
	deleteParty,
	party,
	squares,
	scores,
	winners,
	selectedPlayerFilter,
	activePlayerFilter,
	cleanup,
	numbers,
	verifyHostPin,
} from '$lib/stores/game';
import { mockSupabaseClient } from '../setup';
import { createMockParty, createMockScores, createMockSquare } from '../factories';
import { APP_CONFIG } from '$lib/config';

const refuse = (error: string, field?: string) =>
	mockSupabaseClient.rpc.mockResolvedValueOnce({
		data: { ok: false, error, ...(field ? { field } : {}) },
		error: null,
	});

describe('lockParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await lockParty('1234');
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('applies the locked party and assigned numbers from the response', async () => {
		party.set(createMockParty());
		const assigned = {
			id: 'numbers-id',
			party_id: 'test-party-id',
			row_numbers: [3, 1, 4, 0, 5, 9, 2, 6, 8, 7],
			col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			assigned_at: '2027-02-14T23:30:00.000Z',
		};
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: { ok: true, party: createMockParty({ status: 'active' }), numbers: assigned },
			error: null,
		});

		expect(await lockParty('1234')).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_lock_party', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
		});
		expect(get(party)?.status).toBe('active');
		expect(get(numbers)?.row_numbers).toEqual(assigned.row_numbers);
	});

	it('says why the grid could not be locked', async () => {
		party.set(createMockParty());
		refuse('grid_incomplete');
		expect(await lockParty('1234')).toEqual({
			success: false,
			error: 'All squares must be claimed before the grid can be locked.',
		});
		expect(get(party)?.status).toBe('filling');
	});
});

describe('host action refusals', () => {
	beforeEach(() => {
		cleanup();
		party.set(createMockParty());
	});

	const splits = { q1: 25, q2: 25, q3: 25, final: 25 };
	const details = {
		eventName: 'Big Game',
		kickoffAt: null,
		teamRowName: 'Eagles',
		teamColName: 'Chiefs',
		teamRowColor: '#004C54',
		teamColColor: '#E31837',
	};

	it.each([
		['invalid_pin', 'Incorrect PIN. Please try again.'],
		['locked_out', 'Too many incorrect PINs. Try again in a few minutes.'],
		['not_found', 'This party no longer exists.'],
	])('%s gets the same copy from every host action', async (code, copy) => {
		for (const call of [
			() => lockParty('1234'),
			() => updatePayoutStructure('1234', splits),
			() => updatePartyDetails('1234', details),
			() => removePlayer('1234', 'alice'),
			() => deleteParty('1234'),
			() => verifyHostPin('ABC123', '1234'),
		]) {
			refuse(code);
			expect(await call()).toMatchObject({ success: false, error: copy });
		}
	});

	it.each([
		['lockParty', () => lockParty('1234'), 'Failed to lock party. Please try again.'],
		[
			'updatePayoutStructure',
			() => updatePayoutStructure('1234', splits),
			'Failed to update payout structure. Please try again.',
		],
		[
			'removePlayer',
			() => removePlayer('1234', 'alice'),
			'Failed to remove player. Please try again.',
		],
		['deleteParty', () => deleteParty('1234'), 'Failed to delete party. Please try again.'],
		[
			'verifyHostPin',
			() => verifyHostPin('ABC123', '1234'),
			'Unable to verify PIN. Please try again.',
		],
	])('%s shows its own copy when the request fails', async (_name, call, copy) => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'TypeError: Failed to fetch' },
		});
		expect(await call()).toMatchObject({ success: false, error: copy });

		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 'unexpected', error: null });
		expect(await call()).toMatchObject({ success: false, error: copy });
	});
});

describe('verifyHostPin', () => {
	it('succeeds for the right PIN', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });
		expect(await verifyHostPin('ABC123', '1234')).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_verify_pin', {
			p_party_code: 'ABC123',
			p_pin: '1234',
		});
	});
});

describe('updateScore', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('applies the party, scores and winners from the response', async () => {
		party.set(createMockParty({ status: 'active' }));
		const recorded = createMockScores({ q1_row_score: 14, q1_col_score: 7 });
		const winner = {
			id: 'w1',
			party_id: 'test-party-id',
			quarter: 'q1',
			winning_row: 4,
			winning_col: 7,
			player_name: 'Alice',
			amount: 25,
			created_at: '2027-02-14T23:30:00.000Z',
		};
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: {
				ok: true,
				party: createMockParty({ status: 'active' }),
				scores: recorded,
				winners: [winner],
			},
			error: null,
		});

		expect(await updateScore('1234', 'q1', 14, 7)).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_record_score', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_quarter: 'q1',
			p_row_score: 14,
			p_col_score: 7,
		});
		expect(get(scores)).toMatchObject({ q1_row_score: 14, q1_col_score: 7 });
		expect(get(winners)).toEqual([expect.objectContaining({ player_name: 'Alice' })]);
	});

	it.each([
		['wrong_status', undefined, 'Scores can only be entered while the game is running.'],
		['invalid_input', 'score', 'Scores must be whole numbers of 0 or more.'],
		['invalid_pin', undefined, 'Incorrect PIN. Please try again.'],
	])('maps %s to its copy', async (code, field, copy) => {
		party.set(createMockParty({ status: 'active' }));
		refuse(code, field);
		expect(await updateScore('1234', 'q1', 14, 7)).toEqual({ success: false, error: copy });
	});
});

describe('updatePayoutStructure', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await updatePayoutStructure('1234', { q1: 25, q2: 25, q3: 25, final: 25 });
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('updates local state on success', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: {
				ok: true,
				party: createMockParty({ split_q1: 10, split_q2: 20, split_q3: 30, split_final: 40 }),
			},
			error: null,
		});

		const result = await updatePayoutStructure('1234', { q1: 10, q2: 20, q3: 30, final: 40 });

		expect(result).toEqual({ success: true });
		expect(get(party)).toMatchObject({ split_q1: 10, split_q2: 20, split_q3: 30, split_final: 40 });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_update_payouts', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_split_q1: 10,
			p_split_q2: 20,
			p_split_q3: 30,
			p_split_final: 40,
		});
	});

	it.each([
		['wrong_status', undefined, 'Grid is already locked'],
		['invalid_input', 'splits', 'Each split must be 0–100% and they must add up to 100%.'],
	])('maps %s to its copy', async (code, field, copy) => {
		party.set(createMockParty());
		refuse(code, field);
		const result = await updatePayoutStructure('1234', { q1: 25, q2: 25, q3: 25, final: 20 });
		expect(result).toEqual({ success: false, error: copy });
	});
});

describe('updatePartyDetails', () => {
	const details = {
		eventName: '2027 Championship',
		kickoffAt: '2027-02-14T23:30:00.000Z',
		teamRowName: 'Ravens',
		teamColName: 'Lions',
		teamRowColor: '#241773',
		teamColColor: '#0076B6',
	};

	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		expect(await updatePartyDetails('1234', details)).toEqual({
			success: false,
			error: 'No party loaded',
		});
	});

	it('updates local party state from the response', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: {
				ok: true,
				party: createMockParty({ event_name: '2027 Championship', team_row_name: 'Ravens' }),
			},
			error: null,
		});

		expect(await updatePartyDetails('1234', details)).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_update_details', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_event_name: '2027 Championship',
			p_kickoff_at: '2027-02-14T23:30:00.000Z',
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});
		expect(get(party)).toMatchObject({ event_name: '2027 Championship', team_row_name: 'Ravens' });
	});

	it('sends the configured default event name for a blank one', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: { ok: true, party: createMockParty() },
			error: null,
		});

		await updatePartyDetails('1234', { ...details, eventName: '  ' });

		expect(mockSupabaseClient.rpc.mock.calls[0][1].p_event_name).toBe(APP_CONFIG.defaultEventName);
	});

	it.each([
		['wrong_status', undefined, 'Party details can only be changed before the grid is locked.'],
		['invalid_input', 'teams', 'Choose two different teams for the matchup.'],
		['invalid_input', 'team_color', 'Team colors must be valid hex colors.'],
	])('maps %s %s to its copy', async (code, field, copy) => {
		party.set(createMockParty());
		refuse(code, field);
		expect(await updatePartyDetails('1234', details)).toEqual({ success: false, error: copy });
	});
});

describe('removePlayer', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({ success: false, removedCount: 0, error: 'No party loaded' });
	});

	it('removes player squares and updates local state', async () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' }),
			createMockSquare(0, 1, { player_name: 'Alice', player_name_lower: 'alice' }),
			createMockSquare(0, 2, { player_name: 'Bob', player_name_lower: 'bob' }),
		]);
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { ok: true, removed: 2 }, error: null });

		const result = await removePlayer('1234', 'alice');

		expect(result).toEqual({ success: true, removedCount: 2 });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_remove_player', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_player_name: 'alice',
		});
		expect(get(squares).map((s) => s.player_name)).toEqual([null, null, 'Bob']);
	});

	it('clears an active player filter pointed at the removed player', async () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' }),
			createMockSquare(0, 1, { player_name: 'Bob', player_name_lower: 'bob' }),
		]);
		selectedPlayerFilter.set('alice');
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { ok: true, removed: 1 }, error: null });

		await removePlayer('1234', 'alice');

		expect(get(activePlayerFilter)).toBeNull();
	});

	it('leaves local squares alone when refused', async () => {
		party.set(createMockParty());
		squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
		refuse('invalid_pin');

		const result = await removePlayer('9999', 'alice');

		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'Incorrect PIN. Please try again.',
		});
		expect(get(squares)[0].player_name).toBe('Alice');
	});

	it.each([
		['wrong_status', undefined, 'Cannot remove players after grid is locked'],
		['invalid_input', 'player_name', 'Player name is required.'],
	])('maps %s to its copy', async (code, field, copy) => {
		party.set(createMockParty());
		refuse(code, field);
		expect(await removePlayer('1234', 'alice')).toEqual({
			success: false,
			removedCount: 0,
			error: copy,
		});
	});
});

describe('deleteParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await deleteParty('1234');
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns success on successful delete', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: { ok: true }, error: null });

		expect(await deleteParty('1234')).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('host_delete_party', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
		});
	});
});
