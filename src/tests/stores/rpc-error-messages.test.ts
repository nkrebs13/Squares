/**
 * Characterization table for every RPC-error → user-facing-copy mapping.
 *
 * Written BEFORE the per-call-site humanize*Error copies were folded into one
 * shared `humanizeRpcError` util, to pin each call site's exact output strings
 * through its public entry point. If any row changes, a user-visible error
 * message changed.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	updatePartyDetails,
	updatePayoutStructure,
	removePlayer,
	party,
	cleanup,
} from '$lib/stores/game';
import { createParty } from '$lib/services/createParty';
import type { Party } from '$lib/types';
import { mockSupabaseClient } from '../setup';

function fillingParty(): Party {
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
	};
}

type Row = [raw: string, expected: string];

function rejectNextRpc(message: string) {
	mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message } });
}

describe('RPC error copy (characterization)', () => {
	beforeEach(() => {
		cleanup();
		party.set(fillingParty());
	});

	const payoutRows: Row[] = [
		['ERROR:  invalid party or PIN', 'Invalid PIN'],
		['payout structure can only be changed before the grid is locked', 'Grid is already locked'],
		['splits must sum to exactly 100 (got 90)', 'Splits must add up to 100%'],
		['each split must be between 0 and 100', 'Each split must be between 0% and 100%.'],
		['ERROR: all split values must be provided', 'all split values must be provided'],
		['  ', 'Failed to update payout structure. Please try again.'],
		['', 'Failed to update payout structure. Please try again.'],
	];
	it.each(payoutRows)('updatePayoutStructure: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await updatePayoutStructure('1234', { q1: 25, q2: 25, q3: 25, final: 25 });
		expect(result).toEqual({ success: false, error: expected });
	});

	const detailsRows: Row[] = [
		['ERROR:  invalid party or PIN', 'Invalid PIN'],
		[
			'party details can only be changed before the grid is locked',
			'Party details can only be changed before the grid is locked.',
		],
		['event_name must be at most 80 characters', 'Event name must be 80 characters or fewer.'],
		['matchup must use two different teams', 'Choose two different teams for the matchup.'],
		['team_row_name must be non-empty after trim', 'Team names cannot be blank.'],
		['team_col_name must be non-empty after trim', 'Team names cannot be blank.'],
		['team colors must be 6-digit hex values', 'Team colors must be valid hex colors.'],
		['ERROR: party not found', 'party not found'],
		['', 'Failed to update party details. Please try again.'],
	];
	it.each(detailsRows)('updatePartyDetails: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await updatePartyDetails('1234', {
			eventName: 'Big Game',
			kickoffAt: null,
			teamRowName: 'Eagles',
			teamColName: 'Chiefs',
			teamRowColor: '#004C54',
			teamColColor: '#E31837',
		});
		expect(result).toEqual({ success: false, error: expected });
	});

	const removeRows: Row[] = [
		['ERROR:  invalid party or PIN', 'Invalid PIN'],
		[
			'players can only be removed before the grid is locked',
			'Cannot remove players after grid is locked',
		],
		['player name is required', 'Player name is required'],
		['ERROR: party not found', 'party not found'],
		['', 'Failed to remove player. Please try again.'],
	];
	it.each(removeRows)('removePlayer: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await removePlayer('1234', 'alice');
		expect(result).toEqual({ success: false, removedCount: 0, error: expected });
	});

	const createRows: Row[] = [
		['ERROR:  PIN must be exactly 4 digits', 'PIN must be exactly 4 digits.'],
		['splits must sum to exactly 100', 'Prize splits must total 100%.'],
		['host_name must be non-empty', 'Please enter a host name.'],
		['event_name must be at most 80 characters', 'Event name must be 80 characters or fewer.'],
		['matchup must use two different teams', 'Choose two different teams for the matchup.'],
		['team colors must be 6-digit hex values', 'Team colors must be valid hex colors.'],
		['square_price must be positive', 'Square price must be greater than 0.'],
		[
			'could not generate a unique party code',
			'Could not generate a unique party code — please try again.',
		],
		['ERROR: something unexpected', 'something unexpected'],
		['', 'Failed to create party. Please try again.'],
	];
	it.each(createRows)('createParty: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await createParty({
			hostName: 'Nathan',
			hostPin: '1234',
			squarePrice: 1,
			splits: { q1: 25, q2: 25, q3: 25, final: 25 },
		});
		expect(result).toEqual({ ok: false, error: expected });
	});
});
