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
	cleanup,
} from '$lib/stores/game';
import type { Party, Square } from '$lib/types';
import { mockSupabaseClient } from '../setup';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
		event_name: 'Test Football Squares',
		kickoff_at: null,
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

describe('lockParty', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await lockParty('1234');
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns success on RPC success with data true', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		const result = await lockParty('1234');
		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('lock_party', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
		});
	});

	it('returns error on RPC error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await lockParty('1234');
		expect(result).toEqual({
			success: false,
			error: 'Failed to lock party. Please try again.',
		});
	});

	it('returns error when data is false', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await lockParty('1234');
		expect(result).toEqual({
			success: false,
			error: 'Failed to lock - check PIN and ensure all squares are filled',
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

	it('returns success for valid quarter', async () => {
		party.set(createMockParty({ status: 'active' }));
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_score', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_quarter: 'q1',
			p_row_score: 14,
			p_col_score: 7,
		});
	});

	it('handles all four quarters', async () => {
		party.set(createMockParty({ status: 'active' }));

		const quarters = ['q1', 'q2', 'q3', 'final'] as const;
		for (const q of quarters) {
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });
			const result = await updateScore('1234', q, 10, 20);
			expect(result).toEqual({ success: true });
		}
	});

	it('returns error on RPC error', async () => {
		party.set(createMockParty({ status: 'active' }));
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({
			success: false,
			error: 'Failed to update score. Please try again.',
		});
	});

	it('returns error when data is false', async () => {
		party.set(createMockParty({ status: 'active' }));
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await updateScore('1234', 'q1', 14, 7);
		expect(result).toEqual({
			success: false,
			error: 'Failed to update score - check PIN',
		});
	});
});

describe('updatePayoutStructure', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await updatePayoutStructure('1234', {
			q1: 25,
			q2: 25,
			q3: 25,
			final: 25,
		});
		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns error when party is not filling', async () => {
		for (const status of ['active', 'complete', 'locked'] as const) {
			cleanup();
			party.set(createMockParty({ status }));
			const result = await updatePayoutStructure('1234', {
				q1: 25,
				q2: 25,
				q3: 25,
				final: 25,
			});
			expect(result).toEqual({ success: false, error: 'Grid is already locked' });
		}
	});

	it('returns error when PIN is wrong (server rejects)', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'invalid party or PIN' },
		});

		const result = await updatePayoutStructure('9999', {
			q1: 25,
			q2: 25,
			q3: 25,
			final: 25,
		});
		expect(result).toEqual({ success: false, error: 'Invalid PIN' });
	});

	it('returns error when splits do not sum to 100', async () => {
		party.set(createMockParty({ host_pin: '1234' }));
		const result = await updatePayoutStructure('1234', {
			q1: 25,
			q2: 25,
			q3: 25,
			final: 20,
		});
		expect(result).toEqual({ success: false, error: 'Splits must add up to 100%' });
	});

	it('updates local state on success', async () => {
		const updatedParty = createMockParty({
			split_q1: 10,
			split_q2: 20,
			split_q3: 30,
			split_final: 40,
		});
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: updatedParty, error: null });

		const result = await updatePayoutStructure('1234', {
			q1: 10,
			q2: 20,
			q3: 30,
			final: 40,
		});

		expect(result).toEqual({ success: true });
		const p = get(party);
		expect(p?.split_q1).toBe(10);
		expect(p?.split_q2).toBe(20);
		expect(p?.split_q3).toBe(30);
		expect(p?.split_final).toBe(40);
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_payout_structure', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_split_q1: 10,
			p_split_q2: 20,
			p_split_q3: 30,
			p_split_final: 40,
		});
	});

	it('returns error on Supabase error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await updatePayoutStructure('1234', {
			q1: 10,
			q2: 20,
			q3: 30,
			final: 40,
		});

		expect(result).toEqual({
			success: false,
			error: 'DB error',
		});
	});

	it('returns error when PIN is wrong', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'invalid party or PIN' },
		});

		const result = await updatePayoutStructure('9999', {
			q1: 10,
			q2: 20,
			q3: 30,
			final: 40,
		});

		expect(result).toEqual({ success: false, error: 'Invalid PIN' });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_payout_structure', {
			p_party_id: 'test-party-id',
			p_pin: '9999',
			p_split_q1: 10,
			p_split_q2: 20,
			p_split_q3: 30,
			p_split_final: 40,
		});
	});
});

describe('updatePartyDetails', () => {
	beforeEach(() => {
		cleanup();
	});

	it('returns error when no party loaded', async () => {
		const result = await updatePartyDetails('1234', {
			eventName: '2027 Championship',
			kickoffAt: null,
			teamRowName: 'Eagles',
			teamColName: 'Chiefs',
			teamRowColor: '#004C54',
			teamColColor: '#E31837',
		});

		expect(result).toEqual({ success: false, error: 'No party loaded' });
	});

	it('returns error when party is not filling', async () => {
		party.set(createMockParty({ status: 'active' }));

		const result = await updatePartyDetails('1234', {
			eventName: '2027 Championship',
			kickoffAt: null,
			teamRowName: 'Eagles',
			teamColName: 'Chiefs',
			teamRowColor: '#004C54',
			teamColColor: '#E31837',
		});

		expect(result).toEqual({
			success: false,
			error: 'Party details can only be changed before the grid is locked',
		});
	});

	it('updates local party state from the RPC response', async () => {
		const updatedParty = createMockParty({
			event_name: '2027 Championship',
			kickoff_at: '2027-02-14T23:30:00.000Z',
			team_row_name: 'Ravens',
			team_col_name: 'Lions',
			team_row_color: '#241773',
			team_col_color: '#0076B6',
			expires_at: '2027-02-28T23:30:00.000Z',
		});

		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: updatedParty, error: null });

		const result = await updatePartyDetails('1234', {
			eventName: '2027 Championship',
			kickoffAt: '2027-02-14T23:30:00.000Z',
			teamRowName: 'Ravens',
			teamColName: 'Lions',
			teamRowColor: '#241773',
			teamColColor: '#0076B6',
		});

		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_party_details', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_event_name: '2027 Championship',
			p_kickoff_at: '2027-02-14T23:30:00.000Z',
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});
		expect(get(party)?.event_name).toBe('2027 Championship');
		expect(get(party)?.team_row_name).toBe('Ravens');
	});

	it('humanizes RPC validation errors', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'team_row_name must be non-empty after trim' },
		});

		const result = await updatePartyDetails('1234', {
			eventName: '2027 Championship',
			kickoffAt: null,
			teamRowName: '',
			teamColName: 'Chiefs',
			teamRowColor: '#004C54',
			teamColColor: '#E31837',
		});

		expect(result).toEqual({ success: false, error: 'Team names cannot be blank.' });
	});

	it('humanizes duplicate matchup team errors', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'matchup must use two different teams' },
		});

		const result = await updatePartyDetails('1234', {
			eventName: '2027 Championship',
			kickoffAt: null,
			teamRowName: 'Ravens',
			teamColName: 'Ravens',
			teamRowColor: '#241773',
			teamColColor: '#0076B6',
		});

		expect(result).toEqual({
			success: false,
			error: 'Choose two different teams for the matchup.',
		});
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

	it('returns error when party is not filling', async () => {
		party.set(createMockParty({ status: 'active' }));
		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'Cannot remove players after grid is locked',
		});
	});

	it('returns error when PIN is wrong (server rejects)', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'invalid party or PIN' },
		});

		const result = await removePlayer('9999', 'alice');
		expect(result).toEqual({ success: false, removedCount: 0, error: 'Invalid PIN' });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('remove_player', {
			p_party_id: 'test-party-id',
			p_pin: '9999',
			p_player_name_lower: 'alice',
		});
	});

	it('removes player squares and updates local state', async () => {
		party.set(createMockParty());
		squares.set([
			createMockSquare(0, 0, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
			createMockSquare(0, 1, {
				player_name: 'Alice',
				player_name_lower: 'alice',
			}),
			createMockSquare(0, 2, {
				player_name: 'Bob',
				player_name_lower: 'bob',
			}),
		]);

		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: 2, error: null });

		const result = await removePlayer('1234', 'alice');

		expect(result).toEqual({ success: true, removedCount: 2 });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('remove_player', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
			p_player_name_lower: 'alice',
		});
		const currentSquares = get(squares);
		expect(currentSquares[0].player_name).toBeNull();
		expect(currentSquares[1].player_name).toBeNull();
		expect(currentSquares[2].player_name).toBe('Bob');
	});

	it('returns error on Supabase error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });

		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'DB error',
		});
	});

	it('humanizes server locked-state errors', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'players can only be removed before the grid is locked' },
		});

		const result = await removePlayer('1234', 'alice');

		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'Cannot remove players after grid is locked',
		});
	});

	it('humanizes missing player-name errors', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'player name must be provided' },
		});

		const result = await removePlayer('1234', '');

		expect(result).toEqual({
			success: false,
			removedCount: 0,
			error: 'Player name is required',
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

	it('returns error when PIN is wrong (RPC returns false)', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

		const result = await deleteParty('9999');
		expect(result).toEqual({ success: false, error: 'Invalid PIN' });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_party', {
			p_party_id: 'test-party-id',
			p_pin: '9999',
		});
	});

	it('returns success on successful delete', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

		const result = await deleteParty('1234');
		expect(result).toEqual({ success: true });
		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('delete_party', {
			p_party_id: 'test-party-id',
			p_pin: '1234',
		});
	});

	it('returns error on Supabase error', async () => {
		party.set(createMockParty());
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'DB error' },
		});

		const result = await deleteParty('1234');
		expect(result).toEqual({
			success: false,
			error: 'Failed to delete party. Please try again.',
		});
	});
});
