import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { cleanupParty, ensureSupabaseReady, getServiceRoleClient, getTestClient } from './helpers';

const client = getTestClient();
const createdPartyIds: string[] = [];

async function createParty() {
	const { data, error } = await client.rpc('create_party', {
		p_host_name: 'Test Host',
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
		p_event_name: 'Original Game',
		p_kickoff_at: null,
	});

	if (error) throw new Error(`create_party failed: ${error.message}`);
	createdPartyIds.push(data.id);
	return data;
}

describe('update_party_details RPC', () => {
	beforeAll(async () => {
		await ensureSupabaseReady();
	});

	afterEach(async () => {
		while (createdPartyIds.length > 0) {
			const partyId = createdPartyIds.pop();
			if (partyId) await cleanupParty(client, partyId);
		}
	});

	it('lets the host update event identity while the party is filling', async () => {
		const party = await createParty();
		const kickoffAt = '2027-02-14T23:30:00.000Z';

		const { data: updated, error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: '2027 Championship',
			p_kickoff_at: kickoffAt,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeNull();
		expect(updated.event_name).toBe('2027 Championship');
		expect(updated.kickoff_at).toBeTruthy();
		expect(updated.team_row_name).toBe('Ravens');
		expect(updated.team_col_name).toBe('Lions');
		expect(updated.team_row_color).toBe('#241773');
		expect(updated.team_col_color).toBe('#0076B6');

		const expiresAt = new Date(updated.expires_at);
		const twoWeeksAfterKickoff = new Date(kickoffAt);
		twoWeeksAfterKickoff.setDate(twoWeeksAfterKickoff.getDate() + 14);
		expect(expiresAt.getTime()).toBeGreaterThanOrEqual(twoWeeksAfterKickoff.getTime());
	});

	it('rejects edits with the wrong host PIN', async () => {
		const party = await createParty();

		const { error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '9999',
			p_event_name: 'Wrong Pin Edit',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeTruthy();
		expect(error?.message).toMatch(/invalid party or PIN/i);
	});

	it('rejects same-team matchup edits', async () => {
		const party = await createParty();

		const { error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: 'Duplicate Matchup',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: '  ravens  ',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeTruthy();
		expect(error?.message).toMatch(/different teams/i);
	});

	it('respects a lockout already established by a sibling RPC, rejecting even the correct PIN while locked out (032)', async () => {
		const party = await createParty();

		// Build up a durable lockout via lock_party. lock_party signals PIN
		// failure with `RETURN FALSE` (not RAISE), so check_pin_lockout's
		// pin_attempts increment commits normally on every failed call -- unlike
		// update_party_details itself (see the next test).
		for (let i = 0; i < 5; i++) {
			await client.rpc('lock_party', { p_party_id: party.id, p_pin: '0000' });
		}

		const { data: row, error: readError } = await getServiceRoleClient()
			.from('parties')
			.select('pin_attempts, pin_locked_until')
			.eq('id', party.id)
			.single();
		expect(readError).toBeNull();
		expect(row?.pin_attempts).toBeGreaterThanOrEqual(5);
		expect(row?.pin_locked_until).not.toBeNull();
		expect(new Date(row?.pin_locked_until as string).getTime()).toBeGreaterThan(Date.now());

		// Before migration 032, update_party_details authenticated with a raw
		// `host_pin = p_pin` check that never consulted pin_locked_until, so the
		// correct PIN would have succeeded here regardless of the active
		// lockout. After 032 it calls check_pin_lockout() like every sibling
		// RPC, so the lockout -- once established -- is now respected even
		// though update_party_details's OWN wrong-PIN attempts can't durably
		// contribute to it (see the next test and the migration 032 header
		// comment for why).
		const { error: lockedOutError } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: 'Should Be Locked Out',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(lockedOutError).toBeTruthy();
		expect(lockedOutError?.message).toMatch(/invalid party or PIN/i);
	});

	it('documents a known limitation: its own wrong-PIN attempts do not durably increment pin_attempts (032)', async () => {
		const party = await createParty();

		// update_party_details signals PIN failure via RAISE EXCEPTION (needed
		// to carry a descriptive message back to existing callers), and an
		// uncaught RAISE aborts update_party_details's entire transaction --
		// including check_pin_lockout's own pin_attempts UPDATE performed
		// earlier in that same call. This is a pre-existing PL/pgSQL
		// transaction-semantics gap shared with update_payout_structure (028)
		// and remove_player (029), NOT introduced by 032, and NOT fully
		// closeable without either a new autonomous-transaction extension or a
		// breaking change to the client error contract -- see the migration 032
		// header comment for the full writeup and recommended follow-up. This
		// test exists so the limitation is an explicit, characterized
		// assertion rather than a silent gap.
		for (let i = 0; i < 5; i++) {
			await client.rpc('update_party_details', {
				p_party_id: party.id,
				p_pin: '0000',
				p_event_name: `Attempt ${i}`,
				p_kickoff_at: null,
				p_team_row_name: 'Ravens',
				p_team_col_name: 'Lions',
				p_team_row_color: '#241773',
				p_team_col_color: '#0076B6',
			});
		}

		const { data: row, error: readError } = await getServiceRoleClient()
			.from('parties')
			.select('pin_attempts, pin_locked_until')
			.eq('id', party.id)
			.single();

		expect(readError).toBeNull();
		expect(row?.pin_attempts).toBe(0);
		expect(row?.pin_locked_until).toBeNull();
	});

	it('rejects edits after the grid is locked', async () => {
		const party = await createParty();
		const { error: statusError } = await getServiceRoleClient()
			.from('parties')
			.update({ status: 'active' })
			.eq('id', party.id);
		expect(statusError).toBeNull();

		const { error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: 'Late Edit',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeTruthy();
		expect(error?.message).toMatch(/before the grid is locked/i);
	});
});
