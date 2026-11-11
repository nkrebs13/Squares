/**
 * Network-failure copy for every RPC call site. Refusal codes from the host_*
 * actions are covered in game-admin.test.ts and createParty.test.ts.
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

const SPLITS = { q1: 25, q2: 25, q3: 25, final: 25 };
const DETAILS = {
	eventName: 'Big Game',
	kickoffAt: null,
	teamRowName: 'Eagles',
	teamColName: 'Chiefs',
	teamRowColor: '#004C54',
	teamColColor: '#E31837',
};
const CREATE_INPUT = {
	hostName: 'Nathan',
	hostPin: '1234',
	squarePrice: 1,
	splits: SPLITS,
	teams: {
		row: { name: 'Eagles', color: '#004C54' },
		col: { name: 'Chiefs', color: '#E31837' },
	},
};

function rejectNextRpc(message: string) {
	mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: { message } });
}

describe('RPC error copy (characterization)', () => {
	beforeEach(() => {
		cleanup();
		party.set(createMockParty());
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
