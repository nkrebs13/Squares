/**
 * Characterization table for every RPC-error → user-facing-copy mapping.
 *
 * Written BEFORE the per-call-site humanize*Error copies were folded into one
 * shared `humanizeRpcError` util, to pin each call site's exact output strings
 * through its public entry point. If any row changes, a user-visible error
 * message changed. Each call site's fallback copy is pinned by the network
 * table at the bottom (empty/whitespace handling is covered in rpcError.test.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
	lockParty,
	updateScore,
	deleteParty,
	updatePartyDetails,
	updatePayoutStructure,
	removePlayer,
	party,
	cleanup,
} from '$lib/stores/game';
import { createParty } from '$lib/services/createParty';
import { mockSupabaseClient } from '../setup';
import { createMockParty } from '../factories';

type Row = [raw: string, expected: string];

const SPLITS = { q1: 25, q2: 25, q3: 25, final: 25 };
const DETAILS = {
	eventName: 'Big Game',
	kickoffAt: null,
	teamRowName: 'Eagles',
	teamColName: 'Chiefs',
	teamRowColor: '#004C54',
	teamColColor: '#E31837',
};
const CREATE_INPUT = { hostName: 'Nathan', hostPin: '1234', squarePrice: 1, splits: SPLITS };

function rejectNextRpc(message: string) {
	mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message } });
}

describe('RPC error copy (characterization)', () => {
	beforeEach(() => {
		cleanup();
		party.set(createMockParty());
	});

	const payoutRows: Row[] = [
		['ERROR:  invalid party or PIN', 'Invalid PIN'],
		['payout structure can only be changed before the grid is locked', 'Grid is already locked'],
		['splits must sum to exactly 100 (got 90)', 'Splits must add up to 100%'],
		['each split must be between 0 and 100', 'Each split must be between 0% and 100%.'],
		['ERROR: all split values must be provided', 'all split values must be provided'],
	];
	it.each(payoutRows)('updatePayoutStructure: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await updatePayoutStructure('1234', SPLITS);
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
	];
	it.each(detailsRows)('updatePartyDetails: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await updatePartyDetails('1234', DETAILS);
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
	];
	it.each(createRows)('createParty: %j → %j', async (raw, expected) => {
		rejectNextRpc(raw);
		const result = await createParty(CREATE_INPUT);
		expect(result).toEqual({ ok: false, error: expected });
	});

	// supabase-js reports a rejected fetch as `${name}: ${message}`; none of these
	// may reach the user — every call site shows its own fallback copy instead.
	const networkMessages = [
		'TypeError: Failed to fetch', // Chrome
		'TypeError: NetworkError when attempting to fetch resource.', // Firefox
		'TypeError: Load failed', // Safari
		'TypeError: fetch failed', // Node / undici
		'AbortError: The operation was aborted.',
	];
	const callSites: [name: string, run: () => Promise<unknown>, fallback: string][] = [
		['lockParty', () => lockParty('1234'), 'Failed to lock party. Please try again.'],
		[
			'updateScore',
			() => updateScore('1234', 'q1', 14, 7),
			'Failed to update score. Please try again.',
		],
		['deleteParty', () => deleteParty('1234'), 'Failed to delete party. Please try again.'],
		[
			'updatePayoutStructure',
			() => updatePayoutStructure('1234', SPLITS),
			'Failed to update payout structure. Please try again.',
		],
		[
			'updatePartyDetails',
			() => updatePartyDetails('1234', DETAILS),
			'Failed to update party details. Please try again.',
		],
		[
			'removePlayer',
			() => removePlayer('1234', 'alice'),
			'Failed to remove player. Please try again.',
		],
		['createParty', () => createParty(CREATE_INPUT), 'Failed to create party. Please try again.'],
	];
	describe.each(callSites)('%s on a network failure', (_name, run, fallback) => {
		it.each(networkMessages)('%j → its fallback copy', async (raw) => {
			rejectNextRpc(raw);
			expect(await run()).toMatchObject({ error: fallback });
		});
	});
});
