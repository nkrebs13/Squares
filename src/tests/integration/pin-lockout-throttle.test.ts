import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import {
	claimCell,
	createTestParty,
	ensureSupabaseReady,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
	getTestDatabaseUrl,
	MAX_ATTEMPTS,
	PIN_LOCKOUT_MINUTES,
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

describe('PIN-gated action matrix', () => {
	it('covers every client-callable host_* function that takes a PIN', async () => {
		// host_create_party sets the PIN and host_verify_pin has its own lockout
		// test below. Internal helpers (host_gate, host_pin_check) are not
		// executable by anon, so they are not client API.
		const db = new pg.Client({ connectionString: getTestDatabaseUrl() });
		await db.connect();
		try {
			const { rows } = await db.query<{ proname: string }>(
				`SELECT DISTINCT p.proname
				 FROM pg_proc p
				 JOIN pg_namespace n ON n.oid = p.pronamespace
				 WHERE n.nspname = 'public'
				   AND p.proname LIKE 'host\\_%'
				   AND 'p_pin' = ANY (p.proargnames)
				   AND has_function_privilege('anon', p.oid, 'EXECUTE')
				   AND p.proname NOT IN ('host_create_party', 'host_verify_pin')`
			);
			expect(rows.map((r) => r.proname).sort()).toEqual(ACTIONS.map((a) => a.name).sort());
		} finally {
			await db.end();
		}
	});
});

describe('host_verify_pin lockout', () => {
	it('locks out after five wrong PINs, then refuses the correct PIN', async () => {
		const party = await newParty();
		for (let i = 1; i <= MAX_ATTEMPTS; i++) {
			const { data, error } = await client.rpc('host_verify_pin', {
				p_party_code: party.code,
				p_pin: WRONG_PIN,
			});
			expect(error).toBeNull();
			expect(data).toEqual({ ok: false, error: 'invalid_pin' });
			expect((await readPinState(party.id)).pin_attempts).toBe(i);
		}
		const { data } = await client.rpc('host_verify_pin', {
			p_party_code: party.code,
			p_pin: party.host_pin,
		});
		expect(data).toEqual({ ok: false, error: 'locked_out' });
	});
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
		// The lockout lasts PIN_LOCKOUT_MINUTES (the copy says "a few minutes").
		const lockedFor = new Date(state.pin_locked_until as string).getTime() - Date.now();
		expect(lockedFor).toBeGreaterThan((PIN_LOCKOUT_MINUTES - 1) * 60_000);
		expect(lockedFor).toBeLessThanOrEqual(PIN_LOCKOUT_MINUTES * 60_000);

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
		expect(await readPinState(party.id)).toEqual({ pin_attempts: 0, pin_locked_until: null });
	});

	it('host_remove_player: wrong PINs remove nothing; the correct PIN removes and resets pin_attempts to 0', async () => {
		const party = await newParty();
		const remove = ACTIONS[1];
		expect(await claimCell(client, party.id, 0, 0, 'Alice')).toBe(true);
		expect(await claimCell(client, party.id, 0, 1, 'Alice')).toBe(true);

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
