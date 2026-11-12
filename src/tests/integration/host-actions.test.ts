import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
	claimCell,
	createTestParty,
	ensureSupabaseReady,
	fillAllSquares,
	forceDeleteParty,
	getServiceRoleClient,
	getTestClient,
	type TestParty,
} from './helpers';

// The host_* contract (migration 035): {ok: true, ...} or
// {ok: false, error: <code>[, field]}, and refusals never RAISE.

const client = getTestClient();
const service = getServiceRoleClient();
const created: string[] = [];
const WRONG_PIN = '9999';

async function newParty(status?: string): Promise<TestParty> {
	const party = await createTestParty(client, status ? { status } : {});
	created.push(party.id);
	return party;
}

async function pinState(partyId: string) {
	const { data } = await service
		.from('parties')
		.select('pin_attempts, pin_locked_until')
		.eq('id', partyId)
		.single();
	return data as { pin_attempts: number; pin_locked_until: string | null };
}

async function claim(partyId: string, row: number, col: number, name: string) {
	expect(await claimCell(client, partyId, row, col, name)).toBe(true);
}

beforeAll(async () => {
	await ensureSupabaseReady();
});

afterEach(async () => {
	for (const id of created.splice(0)) await forceDeleteParty(id);
});

describe('host gate', () => {
	it('counts wrong PINs, then answers locked_out even for the right PIN', async () => {
		const party = await newParty();
		for (let i = 1; i <= 5; i++) {
			const { data, error } = await client.rpc('host_delete_party', {
				p_party_id: party.id,
				p_pin: WRONG_PIN,
			});
			expect(error).toBeNull();
			expect(data).toEqual({ ok: false, error: 'invalid_pin' });
			expect((await pinState(party.id)).pin_attempts).toBe(i);
		}

		const { data } = await client.rpc('host_delete_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});
		expect(data).toEqual({ ok: false, error: 'locked_out' });
	});

	it('starts a fresh window once the lockout has expired', async () => {
		const party = await newParty();
		await service
			.from('parties')
			.update({ pin_attempts: 5, pin_locked_until: new Date(Date.now() - 1000).toISOString() })
			.eq('id', party.id);

		const { data } = await client.rpc('host_verify_pin', {
			p_party_code: party.code,
			p_pin: WRONG_PIN,
		});
		expect(data).toEqual({ ok: false, error: 'invalid_pin' });
		expect(await pinState(party.id)).toEqual({ pin_attempts: 1, pin_locked_until: null });
	});

	it('a correct PIN resets the attempt count', async () => {
		const party = await newParty();
		await client.rpc('host_verify_pin', { p_party_code: party.code, p_pin: WRONG_PIN });
		const { data } = await client.rpc('host_verify_pin', {
			p_party_code: party.code,
			p_pin: party.host_pin,
		});
		expect(data).toEqual({ ok: true });
		expect((await pinState(party.id)).pin_attempts).toBe(0);
	});

	it('answers not_found for an unknown party', async () => {
		const { data } = await client.rpc('host_verify_pin', { p_party_code: 'ZZZZZZ', p_pin: '1234' });
		expect(data).toEqual({ ok: false, error: 'not_found' });
	});

	it('refuses an action the party status does not allow', async () => {
		const party = await newParty('active');
		const { data } = await client.rpc('host_update_payouts', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_split_q1: 25,
			p_split_q2: 25,
			p_split_q3: 25,
			p_split_final: 25,
		});
		expect(data).toEqual({ ok: false, error: 'wrong_status' });
	});
});

describe('audit log', () => {
	async function events(partyId: string, eventType: string) {
		const { data } = await service
			.from('audit_log')
			.select('event_type, details')
			.eq('party_id', partyId)
			.eq('event_type', eventType);
		return data ?? [];
	}

	it('records a refused PIN with its reason', async () => {
		const party = await newParty();
		await fillAllSquares(client, party.id);

		const { data } = await client.rpc('host_lock_party', {
			p_party_id: party.id,
			p_pin: WRONG_PIN,
		});
		expect(data).toEqual({ ok: false, error: 'invalid_pin' });

		const failed = await events(party.id, 'lock_party_failed');
		expect(failed).toHaveLength(1);
		expect(failed[0].details).toMatchObject({ reason: 'invalid_pin' });

		const { data: row } = await service
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();
		expect(row?.status).toBe('filling');
	});

	it('records a successful lock', async () => {
		const party = await newParty();
		await fillAllSquares(client, party.id);
		await client.rpc('host_lock_party', { p_party_id: party.id, p_pin: party.host_pin });

		expect(await events(party.id, 'lock_party_success')).toHaveLength(1);
	});

	it('records a refused delete, and a successful one survives the party (party_id NULL)', async () => {
		const party = await newParty();
		await client.rpc('host_delete_party', { p_party_id: party.id, p_pin: WRONG_PIN });
		const failed = await events(party.id, 'delete_party_failed');
		expect(failed).toHaveLength(1);
		expect(failed[0].details).toMatchObject({ reason: 'invalid_pin' });

		const { data: stillThere } = await client.from('parties').select('id').eq('id', party.id);
		expect(stillThere).toHaveLength(1);

		await client.rpc('host_delete_party', { p_party_id: party.id, p_pin: party.host_pin });
		const { data: logs } = await service
			.from('audit_log')
			.select('party_id, details')
			.eq('event_type', 'delete_party_success')
			.contains('details', { deleted_party_id: party.id });
		expect(logs).toHaveLength(1);
		expect(logs?.[0].party_id).toBeNull();
		expect(logs?.[0].details.code).toBe(party.code);
	});
});

describe('host_lock_party', () => {
	it('refuses a party that is already active', async () => {
		const party = await newParty('active');
		await fillAllSquares(client, party.id);
		const { data } = await client.rpc('host_lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});
		expect(data).toEqual({ ok: false, error: 'wrong_status' });
	});

	it('refuses an incomplete grid', async () => {
		const party = await newParty();
		const { data } = await client.rpc('host_lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});
		expect(data).toEqual({ ok: false, error: 'grid_incomplete' });
	});

	it('assigns numbers and returns the active party', async () => {
		const party = await newParty();
		await fillAllSquares(client, party.id);

		const { data } = await client.rpc('host_lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		expect(data.ok).toBe(true);
		expect(data.party).toMatchObject({ id: party.id, status: 'active' });
		expect(data.party).not.toHaveProperty('host_pin');
		expect([...data.numbers.row_numbers].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect([...data.numbers.col_numbers].sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});
});

describe('host_remove_player', () => {
	it('clears every square of the player, case-insensitively', async () => {
		const party = await newParty();
		await claim(party.id, 0, 0, 'Alice');
		await claim(party.id, 0, 1, 'Alice');
		await claim(party.id, 0, 2, 'Bob');

		const { data } = await client.rpc('host_remove_player', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_player_name: ' ALICE ',
		});
		expect(data).toEqual({ ok: true, removed: 2 });

		const { data: owners } = await client
			.from('squares')
			.select('player_name')
			.eq('party_id', party.id)
			.not('player_name', 'is', null);
		expect(owners).toEqual([{ player_name: 'Bob' }]);
	});

	it('refuses a blank name', async () => {
		const party = await newParty();
		const { data } = await client.rpc('host_remove_player', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_player_name: '  ',
		});
		expect(data).toEqual({ ok: false, error: 'invalid_input', field: 'player_name' });
	});
});

describe('host_update_payouts', () => {
	it('saves splits that total 100 and returns the party', async () => {
		const party = await newParty();
		const { data } = await client.rpc('host_update_payouts', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_split_q1: 10,
			p_split_q2: 20,
			p_split_q3: 30,
			p_split_final: 40,
		});
		expect(data.ok).toBe(true);
		expect(data.party).toMatchObject({ split_q1: 10, split_q2: 20, split_q3: 30, split_final: 40 });
	});

	it.each([
		[25, 25, 25, 26],
		[-10, 40, 35, 35],
		[2147483647, 1, 1, 1],
	])('refuses splits %i/%i/%i/%i', async (q1, q2, q3, final) => {
		const party = await newParty();
		const { data } = await client.rpc('host_update_payouts', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_split_q1: q1,
			p_split_q2: q2,
			p_split_q3: q3,
			p_split_final: final,
		});
		expect(data).toEqual({ ok: false, error: 'invalid_input', field: 'splits' });
	});
});

describe('host_delete_party', () => {
	it('deletes the party with the right PIN', async () => {
		const party = await newParty();
		const { data } = await client.rpc('host_delete_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});
		expect(data).toEqual({ ok: true });

		const { data: rows } = await client.from('parties').select('id').eq('id', party.id);
		expect(rows).toEqual([]);
	});
});
