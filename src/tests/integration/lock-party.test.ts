import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getTestClient,
	createTestParty,
	fillAllSquares,
	cleanupParty,
	type TestParty,
} from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient;
let party: TestParty;

beforeEach(async () => {
	client = getTestClient();
	party = await createTestParty(client);
});

afterEach(async () => {
	await cleanupParty(client, party.id);
});

describe('lock_party RPC', () => {
	it('locks a fully-filled party — status becomes active, numbers generated, scores inserted', async () => {
		await fillAllSquares(client, party.id);

		const { data } = await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		expect(data).toBe(true);

		// Status should be 'active'
		const { data: updatedParty } = await client
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();

		expect(updatedParty!.status).toBe('active');

		// Numbers should be generated
		const { data: numbers } = await client
			.from('numbers')
			.select('row_numbers, col_numbers')
			.eq('party_id', party.id)
			.single();

		expect(numbers).not.toBeNull();
		expect(numbers!.row_numbers).toHaveLength(10);
		expect(numbers!.col_numbers).toHaveLength(10);

		// Scores record should exist
		const { data: scores } = await client
			.from('scores')
			.select('party_id')
			.eq('party_id', party.id)
			.single();

		expect(scores).not.toBeNull();
	});

	it('rejects wrong PIN and returns false', async () => {
		await fillAllSquares(client, party.id);

		const { data } = await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: '9999',
		});

		expect(data).toBe(false);

		// Status should still be 'filling'
		const { data: unchanged } = await client
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();

		expect(unchanged!.status).toBe('filling');
	});

	it('logs audit event on wrong PIN', async () => {
		await fillAllSquares(client, party.id);

		await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: '9999',
		});

		const { data: logs } = await client
			.from('audit_log')
			.select('event_type, details')
			.eq('party_id', party.id)
			.eq('event_type', 'lock_party_failed');

		expect(logs).not.toBeNull();
		expect(logs!.length).toBeGreaterThanOrEqual(1);
		expect(logs![0].details).toMatchObject({ reason: 'invalid_pin' });
	});

	it('rejects incomplete grid (99/100 filled)', async () => {
		// Fill only 99 squares (skip row=9, col=9)
		for (let row = 0; row < 10; row++) {
			for (let col = 0; col < 10; col++) {
				if (row === 9 && col === 9) continue;
				await client
					.from('squares')
					.update({ player_name: `Player-R${row}C${col}`, claimed_at: new Date().toISOString() })
					.eq('party_id', party.id)
					.eq('row_num', row)
					.eq('col_num', col);
			}
		}

		const { data } = await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		expect(data).toBe(false);
	});

	it('rejects if party is already active', async () => {
		await fillAllSquares(client, party.id);
		await client.from('parties').update({ status: 'active' }).eq('id', party.id);

		const { data } = await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		expect(data).toBe(false);
	});

	it('generates valid number arrays (10 elements each, contain 0-9)', async () => {
		await fillAllSquares(client, party.id);
		await client.rpc('lock_party', { p_party_id: party.id, p_pin: party.host_pin });

		const { data: numbers } = await client
			.from('numbers')
			.select('row_numbers, col_numbers')
			.eq('party_id', party.id)
			.single();

		const rowSorted = [...numbers!.row_numbers].sort((a, b) => a - b);
		const colSorted = [...numbers!.col_numbers].sort((a, b) => a - b);

		expect(rowSorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
		expect(colSorted).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	});

	it('logs lock_party_success audit event', async () => {
		await fillAllSquares(client, party.id);
		await client.rpc('lock_party', { p_party_id: party.id, p_pin: party.host_pin });

		const { data: logs } = await client
			.from('audit_log')
			.select('event_type')
			.eq('party_id', party.id)
			.eq('event_type', 'lock_party_success');

		expect(logs).not.toBeNull();
		expect(logs!.length).toBeGreaterThanOrEqual(1);
	});
});
