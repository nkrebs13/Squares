import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	ensureSupabaseReady,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
} from './helpers';

// Migration 033 regression suite: PIN/lockout failure in update_payout_structure
// and remove_player now returns a NULL sentinel instead of RAISE, so
// check_pin_lockout's pin_attempts increment durably commits (an uncaught RAISE
// aborted the RPC's single-statement PostgREST transaction and rolled the
// increment back, leaving these RPCs unthrottled brute-force oracles for the
// 4-digit host PIN). update_party_details is covered in update-party-details.test.ts.

const client = getTestClient();
const service = getServiceRoleClient();
const createdPartyIds: string[] = [];

async function createParty() {
	const { data, error } = await client.rpc('create_party', {
		p_host_name: 'Throttle Host',
		p_pin: '1234',
		p_square_price: 1,
		p_split_q1: 25,
		p_split_q2: 25,
		p_split_q3: 25,
		p_split_final: 25,
		p_team_row_name: 'Eagles',
		p_team_col_name: 'Chiefs',
		p_team_row_color: '#004C54',
		p_team_col_color: '#E31837',
		p_event_name: 'Throttle Test Game',
		p_kickoff_at: null,
	});
	if (error) throw new Error(`create_party failed: ${error.message}`);
	createdPartyIds.push(data.id);
	return data;
}

async function readPinState(partyId: string) {
	const { data, error } = await service
		.from('parties')
		.select('pin_attempts, pin_locked_until')
		.eq('id', partyId)
		.single();
	expect(error).toBeNull();
	return data as { pin_attempts: number; pin_locked_until: string | null };
}

describe('PIN lockout throttle (migration 033)', () => {
	beforeAll(async () => {
		await ensureSupabaseReady();
	});

	afterEach(async () => {
		// Force-delete: tests here intentionally lock parties out, so
		// delete_party('1234') would itself be throttled and leak the row.
		while (createdPartyIds.length > 0) {
			const partyId = createdPartyIds.pop();
			if (partyId) await forceDeleteParty(partyId);
		}
	});

	describe('update_payout_structure', () => {
		it('durably increments pin_attempts on each wrong PIN and engages lockout', async () => {
			const party = await createParty();

			for (let i = 0; i < 5; i++) {
				const { data, error } = await client.rpc('update_payout_structure', {
					p_party_id: party.id,
					p_pin: '0000',
					p_split_q1: 25,
					p_split_q2: 25,
					p_split_q3: 25,
					p_split_final: 25,
				});
				// Rejected PIN => NULL sentinel, no raised error. A NULL `RETURNS
				// parties` value surfaces as an all-null-column row object, so the
				// refusal is signalled by the absent id (not bare null).
				expect(error).toBeNull();
				expect(data == null || data.id == null).toBe(true);
			}

			const state = await readPinState(party.id);
			expect(state.pin_attempts).toBeGreaterThanOrEqual(5);
			expect(state.pin_locked_until).not.toBeNull();
			expect(new Date(state.pin_locked_until as string).getTime()).toBeGreaterThan(Date.now());

			// 6th call WITH the correct PIN is still refused while locked out.
			const { data: lockedData, error: lockedError } = await client.rpc('update_payout_structure', {
				p_party_id: party.id,
				p_pin: '1234',
				p_split_q1: 10,
				p_split_q2: 20,
				p_split_q3: 30,
				p_split_final: 40,
			});
			expect(lockedError).toBeNull();
			expect(lockedData == null || lockedData.id == null).toBe(true);

			// The locked-out correct-PIN call must not have applied the update.
			const { data: unchanged } = await service
				.from('parties')
				.select('split_q1')
				.eq('id', party.id)
				.single();
			expect(unchanged?.split_q1).toBe(25);
		});

		it('lets the correct PIN succeed and resets pin_attempts to 0', async () => {
			const party = await createParty();

			for (let i = 0; i < 3; i++) {
				await client.rpc('update_payout_structure', {
					p_party_id: party.id,
					p_pin: '0000',
					p_split_q1: 25,
					p_split_q2: 25,
					p_split_q3: 25,
					p_split_final: 25,
				});
			}
			expect((await readPinState(party.id)).pin_attempts).toBe(3);

			const { data: updated, error } = await client.rpc('update_payout_structure', {
				p_party_id: party.id,
				p_pin: '1234',
				p_split_q1: 10,
				p_split_q2: 20,
				p_split_q3: 30,
				p_split_final: 40,
			});
			expect(error).toBeNull();
			expect(updated.split_q1).toBe(10);
			expect(updated.split_final).toBe(40);

			const state = await readPinState(party.id);
			expect(state.pin_attempts).toBe(0);
			expect(state.pin_locked_until).toBeNull();
		});

		it('still RAISEs non-PIN validation errors with their original messages', async () => {
			const party = await createParty();

			// Correct PIN, but splits do not sum to 100 -> must still RAISE (and
			// roll back), NOT return a sentinel. Client code regex-matches this.
			const { error } = await client.rpc('update_payout_structure', {
				p_party_id: party.id,
				p_pin: '1234',
				p_split_q1: 25,
				p_split_q2: 25,
				p_split_q3: 25,
				p_split_final: 20,
			});
			expect(error).toBeTruthy();
			expect(error?.message).toMatch(/sum to exactly 100/i);
		});
	});

	describe('remove_player', () => {
		async function claim(partyId: string, row: number, col: number, name: string) {
			const { error } = await client.rpc('claim_square', {
				p_party_id: partyId,
				p_row: row,
				p_col: col,
				p_player_name: name,
			});
			if (error) throw new Error(`claim_square failed: ${error.message}`);
		}

		it('durably increments pin_attempts on each wrong PIN and engages lockout', async () => {
			const party = await createParty();

			for (let i = 0; i < 5; i++) {
				const { data, error } = await client.rpc('remove_player', {
					p_party_id: party.id,
					p_pin: '0000',
					p_player_name_lower: 'alice',
				});
				// Rejected PIN => NULL sentinel (distinct from a legitimate 0), no error.
				expect(error).toBeNull();
				expect(data).toBeNull();
			}

			const state = await readPinState(party.id);
			expect(state.pin_attempts).toBeGreaterThanOrEqual(5);
			expect(state.pin_locked_until).not.toBeNull();
			expect(new Date(state.pin_locked_until as string).getTime()).toBeGreaterThan(Date.now());

			// 6th call WITH the correct PIN is still refused while locked out.
			const { data: lockedData, error: lockedError } = await client.rpc('remove_player', {
				p_party_id: party.id,
				p_pin: '1234',
				p_player_name_lower: 'alice',
			});
			expect(lockedError).toBeNull();
			expect(lockedData).toBeNull();
		});

		it('lets the correct PIN succeed, removes squares, and resets pin_attempts to 0', async () => {
			const party = await createParty();
			await claim(party.id, 0, 0, 'Alice');
			await claim(party.id, 0, 1, 'Alice');

			for (let i = 0; i < 3; i++) {
				await client.rpc('remove_player', {
					p_party_id: party.id,
					p_pin: '0000',
					p_player_name_lower: 'alice',
				});
			}
			expect((await readPinState(party.id)).pin_attempts).toBe(3);

			const { data: removedCount, error } = await client.rpc('remove_player', {
				p_party_id: party.id,
				p_pin: '1234',
				p_player_name_lower: 'alice',
			});
			expect(error).toBeNull();
			expect(removedCount).toBe(2);

			const state = await readPinState(party.id);
			expect(state.pin_attempts).toBe(0);
			expect(state.pin_locked_until).toBeNull();
		});

		it('still RAISEs non-PIN validation errors with their original messages', async () => {
			const party = await createParty();
			// Lock the grid so remove_player hits its post-PIN status guard.
			const { error: statusError } = await service
				.from('parties')
				.update({ status: 'active' })
				.eq('id', party.id);
			expect(statusError).toBeNull();

			// Correct PIN, but grid is locked -> must still RAISE, NOT return a sentinel.
			const { error } = await client.rpc('remove_player', {
				p_party_id: party.id,
				p_pin: '1234',
				p_player_name_lower: 'alice',
			});
			expect(error).toBeTruthy();
			expect(error?.message).toMatch(/before the grid is locked/i);
		});
	});
});
