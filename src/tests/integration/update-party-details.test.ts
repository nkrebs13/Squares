import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import {
	ensureSupabaseReady,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
} from './helpers';

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
		// Force-delete via service role: some tests below intentionally drive the
		// party into PIN lockout, which would refuse delete_party('1234') too.
		while (createdPartyIds.length > 0) {
			const partyId = createdPartyIds.pop();
			if (partyId) await forceDeleteParty(partyId);
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

	it('rejects edits with the wrong host PIN via the null sentinel (033)', async () => {
		const party = await createParty();

		// Migration 033: a wrong PIN is refused with a NULL sentinel return (NOT a
		// RAISE) so the check_pin_lockout throttle increment durably commits. A
		// NULL `RETURNS parties` value surfaces as a row object with all-null
		// columns (id included), so assert the refusal via the absent id.
		const { data, error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '9999',
			p_event_name: 'Wrong Pin Edit',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeNull();
		expect(data == null || data.id == null).toBe(true);

		// And the durable throttle actually incremented.
		const { data: row } = await getServiceRoleClient()
			.from('parties')
			.select('pin_attempts')
			.eq('id', party.id)
			.single();
		expect(row?.pin_attempts).toBe(1);
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
		// pin_attempts increment commits normally on every failed call. As of
		// migration 033, update_party_details's own wrong-PIN attempts commit the
		// increment too (see the next test) -- so this cross-RPC lockout is now
		// merely one of several ways to reach the same locked state.
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

		// Migration 033 keeps update_party_details routed through
		// check_pin_lockout(), whose lockout short-circuit returns FALSE before
		// any write, so the RPC refuses even the CORRECT PIN while the lockout is
		// active. The refusal is now a NULL sentinel return (not a RAISE), so the
		// throttle increment can commit -- assert the null-data / no-error shape.
		const { data: lockedOutData, error: lockedOutError } = await client.rpc(
			'update_party_details',
			{
				p_party_id: party.id,
				p_pin: '1234',
				p_event_name: 'Should Be Locked Out',
				p_kickoff_at: null,
				p_team_row_name: 'Ravens',
				p_team_col_name: 'Lions',
				p_team_row_color: '#241773',
				p_team_col_color: '#0076B6',
			}
		);

		expect(lockedOutError).toBeNull();
		expect(lockedOutData == null || lockedOutData.id == null).toBe(true);
	});

	it('durably increments pin_attempts on its own wrong-PIN attempts and engages lockout (033)', async () => {
		const party = await createParty();

		// Migration 033 supersedes migration 032's documented limitation.
		// update_party_details now signals PIN failure with a NULL sentinel return
		// instead of RAISE. Because a normal RETURN commits the RPC's
		// single-statement PostgREST transaction (whereas an uncaught RAISE aborted
		// it and rolled back check_pin_lockout's own pin_attempts UPDATE), five
		// wrong PINs from THIS RPC alone now durably accumulate and engage the
		// 5-failure lockout. This is the assertion that FAILED before 033
		// (pin_attempts stayed 0) and PASSES after it.
		for (let i = 0; i < 5; i++) {
			const { data, error } = await client.rpc('update_party_details', {
				p_party_id: party.id,
				p_pin: '0000',
				p_event_name: `Attempt ${i}`,
				p_kickoff_at: null,
				p_team_row_name: 'Ravens',
				p_team_col_name: 'Lions',
				p_team_row_color: '#241773',
				p_team_col_color: '#0076B6',
			});
			expect(error).toBeNull();
			expect(data == null || data.id == null).toBe(true);
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

		// The 6th call, now WITH the correct PIN, is still refused while locked.
		const { data: lockedData, error: lockedError } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: 'Correct PIN But Locked',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});
		expect(lockedError).toBeNull();
		expect(lockedData == null || lockedData.id == null).toBe(true);
	});

	it('lets the correct PIN succeed and resets pin_attempts to 0 (033)', async () => {
		const party = await createParty();

		// A few wrong PINs (below the 5-failure threshold) accumulate...
		for (let i = 0; i < 3; i++) {
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

		const { data: mid } = await getServiceRoleClient()
			.from('parties')
			.select('pin_attempts')
			.eq('id', party.id)
			.single();
		expect(mid?.pin_attempts).toBe(3);

		// ...then the correct PIN succeeds and check_pin_lockout resets the counter.
		const { data: updated, error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: 'Recovered',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});
		expect(error).toBeNull();
		expect(updated?.event_name).toBe('Recovered');

		const { data: after } = await getServiceRoleClient()
			.from('parties')
			.select('pin_attempts, pin_locked_until')
			.eq('id', party.id)
			.single();
		expect(after?.pin_attempts).toBe(0);
		expect(after?.pin_locked_until).toBeNull();
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
