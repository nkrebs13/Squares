import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	claimCell,
	createTestParty,
	ensureSupabaseReady,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
	type TestParty,
} from './helpers';

// Migration 033 invariant, now carried by the host_* contract: a refused PIN is
// RETURNED ({ok:false, error}), never RAISEd. PostgREST runs each RPC as one
// transaction, so a RAISE would roll back host_pin_check's own pin_attempts
// increment and leave the action an unthrottled brute-force oracle for the
// 4-digit host PIN. Every PIN-gated action must therefore durably count wrong
// PINs, lock out after 5 and refuse even the correct PIN while locked out.

const client = getTestClient();
const service = getServiceRoleClient();
const createdPartyIds: string[] = [];
const WRONG_PIN = '0000';
const MAX_ATTEMPTS = 5;

type Args = Record<string, unknown>;

// One entry per PIN-gated host_* action. `args` builds the call for a party.
const ACTIONS: { name: string; args: (party: TestParty, pin: string) => Args }[] = [
	{
		name: 'host_update_payouts',
		args: (p, pin) => ({
			p_party_id: p.id,
			p_pin: pin,
			p_split_q1: 10,
			p_split_q2: 20,
			p_split_q3: 30,
			p_split_final: 40,
		}),
	},
	{
		name: 'host_remove_player',
		args: (p, pin) => ({ p_party_id: p.id, p_pin: pin, p_player_name: 'alice' }),
	},
	{
		name: 'host_update_details',
		args: (p, pin) => ({
			p_party_id: p.id,
			p_pin: pin,
			p_event_name: 'Throttle',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		}),
	},
	{ name: 'host_lock_party', args: (p, pin) => ({ p_party_id: p.id, p_pin: pin }) },
	{ name: 'host_delete_party', args: (p, pin) => ({ p_party_id: p.id, p_pin: pin }) },
	{
		name: 'host_record_score',
		args: (p, pin) => ({
			p_party_id: p.id,
			p_pin: pin,
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		}),
	},
];

async function newParty(): Promise<TestParty> {
	const party = await createTestParty(client);
	createdPartyIds.push(party.id);
	return party;
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

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	// Force-delete: tests here intentionally lock parties out, so
	// host_delete_party('1234') would itself be refused and leak the row.
	for (const id of createdPartyIds.splice(0)) await forceDeleteParty(id);
});

describe.each(ACTIONS)('PIN lockout throttle: $name', ({ name, args }) => {
	it('durably counts each wrong PIN, locks out at the limit, and refuses the correct PIN', async () => {
		const party = await newParty();

		for (let i = 1; i <= MAX_ATTEMPTS; i++) {
			const { data, error } = await client.rpc(name, args(party, WRONG_PIN));
			// Refusal is a returned code, not a raised error: that is what lets the
			// attempt increment commit.
			expect(error).toBeNull();
			expect(data).toEqual({ ok: false, error: 'invalid_pin' });
			expect((await readPinState(party.id)).pin_attempts).toBe(i);
		}

		const state = await readPinState(party.id);
		expect(state.pin_locked_until).not.toBeNull();
		expect(new Date(state.pin_locked_until as string).getTime()).toBeGreaterThan(Date.now());

		const { data: locked, error: lockedError } = await client.rpc(
			name,
			args(party, party.host_pin)
		);
		expect(lockedError).toBeNull();
		expect(locked).toEqual({ ok: false, error: 'locked_out' });
		// The refused correct-PIN call applied nothing.
		const { data: row } = await service
			.from('parties')
			.select('status, split_q1, event_name')
			.eq('id', party.id)
			.single();
		expect(row).toEqual({ status: 'filling', split_q1: 25, event_name: 'Integration Test Game' });
	});
});

describe('PIN lockout throttle: across actions', () => {
	it('a lockout built by one action blocks every other action, even with the correct PIN', async () => {
		const party = await newParty();
		const [first, ...others] = ACTIONS;

		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			await client.rpc(first.name, first.args(party, WRONG_PIN));
		}

		for (const action of others) {
			const { data, error } = await client.rpc(action.name, action.args(party, party.host_pin));
			expect(error).toBeNull();
			expect(data, action.name).toEqual({ ok: false, error: 'locked_out' });
		}
	});

	it('wrong PINs on different actions share one counter', async () => {
		const party = await newParty();
		await client.rpc('host_update_payouts', ACTIONS[0].args(party, WRONG_PIN));
		await client.rpc('host_remove_player', ACTIONS[1].args(party, WRONG_PIN));
		await client.rpc('host_lock_party', ACTIONS[3].args(party, WRONG_PIN));

		expect((await readPinState(party.id)).pin_attempts).toBe(3);
	});
});

describe('PIN lockout throttle: recovery', () => {
	it('host_update_payouts: the correct PIN succeeds and resets pin_attempts to 0', async () => {
		const party = await newParty();
		const [payouts] = ACTIONS;

		for (let i = 0; i < 3; i++) await client.rpc(payouts.name, payouts.args(party, WRONG_PIN));
		expect((await readPinState(party.id)).pin_attempts).toBe(3);

		const { data, error } = await client.rpc(payouts.name, payouts.args(party, party.host_pin));
		expect(error).toBeNull();
		expect(data.ok).toBe(true);
		expect(data.party).toMatchObject({ split_q1: 10, split_final: 40 });
		expect(await readPinState(party.id)).toEqual({ pin_attempts: 0, pin_locked_until: null });
	});

	it('host_remove_player: the correct PIN removes the squares and resets pin_attempts to 0', async () => {
		const party = await newParty();
		expect(await claimCell(client, party.id, 0, 0, 'Alice')).toBe(true);
		expect(await claimCell(client, party.id, 0, 1, 'Alice')).toBe(true);
		const remove = ACTIONS[1];

		for (let i = 0; i < 3; i++) await client.rpc(remove.name, remove.args(party, WRONG_PIN));
		expect((await readPinState(party.id)).pin_attempts).toBe(3);

		const { data, error } = await client.rpc(remove.name, remove.args(party, party.host_pin));
		expect(error).toBeNull();
		expect(data).toEqual({ ok: true, removed: 2 });
		expect(await readPinState(party.id)).toEqual({ pin_attempts: 0, pin_locked_until: null });
	});
});

describe('host refusals other than the PIN', () => {
	it('come back as codes, not raised errors', async () => {
		const party = await newParty();

		// Correct PIN, splits that do not total 100.
		const payouts = await client.rpc('host_update_payouts', {
			...ACTIONS[0].args(party, party.host_pin),
			p_split_final: 20,
		});
		expect(payouts.error).toBeNull();
		expect(payouts.data).toEqual({ ok: false, error: 'invalid_input', field: 'splits' });

		// Correct PIN, grid locked.
		await service.from('parties').update({ status: 'active' }).eq('id', party.id);
		const remove = await client.rpc('host_remove_player', ACTIONS[1].args(party, party.host_pin));
		expect(remove.error).toBeNull();
		expect(remove.data).toEqual({ ok: false, error: 'wrong_status' });
	});
});
