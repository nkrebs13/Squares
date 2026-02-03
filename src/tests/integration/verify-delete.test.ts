import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	getTestClient,
	createTestParty,
	fillAllSquares,
	lockParty,
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
	// Party may already be deleted in some tests — cleanupParty is safe to call regardless
	await cleanupParty(client, party.id);
});

describe('verify_host_pin RPC', () => {
	it('returns true for correct PIN', async () => {
		const { data } = await client.rpc('verify_host_pin', {
			p_party_code: party.code,
			p_pin: party.host_pin,
		});

		expect(data).toBe(true);
	});

	it('returns false for wrong PIN', async () => {
		const { data } = await client.rpc('verify_host_pin', {
			p_party_code: party.code,
			p_pin: '9999',
		});

		expect(data).toBe(false);
	});

	it('returns null for non-existent code', async () => {
		const { data } = await client.rpc('verify_host_pin', {
			p_party_code: 'ZZZZZ9',
			p_pin: '1234',
		});

		// When party doesn't exist, v_host_pin is NULL, so (NULL = '1234') → NULL
		expect(data).toBeNull();
	});
});

describe('delete_party RPC', () => {
	it('deletes party with correct PIN and returns true', async () => {
		const { data } = await client.rpc('delete_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		expect(data).toBe(true);

		// Verify party is gone
		const { data: gone } = await client
			.from('parties')
			.select('id')
			.eq('id', party.id)
			.maybeSingle();

		expect(gone).toBeNull();
	});

	it('rejects wrong PIN and returns false', async () => {
		const { data } = await client.rpc('delete_party', {
			p_party_id: party.id,
			p_pin: '9999',
		});

		expect(data).toBe(false);

		// Party still exists
		const { data: stillThere } = await client
			.from('parties')
			.select('id')
			.eq('id', party.id)
			.single();

		expect(stillThere).not.toBeNull();
	});

	it('logs audit event on wrong PIN', async () => {
		await client.rpc('delete_party', {
			p_party_id: party.id,
			p_pin: '9999',
		});

		const { data: logs } = await client
			.from('audit_log')
			.select('event_type, details')
			.eq('party_id', party.id)
			.eq('event_type', 'delete_party_failed');

		expect(logs?.length).toBeGreaterThanOrEqual(1);
		expect(logs?.[0]?.details).toMatchObject({ reason: 'invalid_pin' });
	});

	it('cascades deletion to squares, numbers, scores, and winners', async () => {
		await fillAllSquares(client, party.id);
		await lockParty(client, party.id, party.host_pin);

		// Enter a score to create a winner
		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});

		// Delete
		await client.rpc('delete_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		// All children should be gone
		const { data: squares } = await client.from('squares').select('id').eq('party_id', party.id);
		expect(squares).toHaveLength(0);

		const { data: numbers } = await client
			.from('numbers')
			.select('party_id')
			.eq('party_id', party.id);
		expect(numbers).toHaveLength(0);

		const { data: scores } = await client
			.from('scores')
			.select('party_id')
			.eq('party_id', party.id);
		expect(scores).toHaveLength(0);

		const { data: winners } = await client.from('winners').select('id').eq('party_id', party.id);
		expect(winners).toHaveLength(0);
	});

	it('audit log survives party deletion (FK ON DELETE SET NULL)', async () => {
		// delete_party logs with party_id = NULL (uses deleted_party_id in details instead)
		const partyId = party.id;
		const partyCode = party.code;

		await client.rpc('delete_party', {
			p_party_id: partyId,
			p_pin: party.host_pin,
		});

		// The success log uses party_id=NULL and includes the deleted ID in details
		const { data: logs } = await client
			.from('audit_log')
			.select('event_type, party_id, details')
			.eq('event_type', 'delete_party_success')
			.contains('details', { deleted_party_id: partyId });

		expect(logs?.length).toBeGreaterThanOrEqual(1);
		// party_id should be NULL since it's logged before delete with NULL
		expect(logs?.[0]?.party_id).toBeNull();
		expect(logs?.[0]?.details?.code).toBe(partyCode);
	});
});
