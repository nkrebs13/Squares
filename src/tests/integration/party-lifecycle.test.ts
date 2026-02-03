import { describe, it, expect, afterEach } from 'vitest';
import { getTestClient, createTestParty, cleanupParty, type TestParty } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient;
let party: TestParty;

afterEach(async () => {
	if (party) {
		await cleanupParty(client, party.id);
	}
});

describe('full party lifecycle', () => {
	it('create → claim → lock → score all quarters → complete → delete', async () => {
		client = getTestClient();

		// ─── Step 1: Create party ───
		party = await createTestParty(client, { square_price: 2 });

		const { data: created } = await client
			.from('parties')
			.select('status, square_price')
			.eq('id', party.id)
			.single();

		expect(created?.status).toBe('filling');
		expect(Number(created?.square_price)).toBe(2);

		// Verify 100 empty squares exist
		const { data: emptySquares } = await client
			.from('squares')
			.select('id')
			.eq('party_id', party.id);

		expect(emptySquares).toHaveLength(100);

		// ─── Step 2: Claim all 100 squares (mix of single + batch) ───
		// Claim first 10 individually
		for (let col = 0; col < 10; col++) {
			const { data } = await client.rpc('claim_square', {
				p_party_id: party.id,
				p_row: 0,
				p_col: col,
				p_player_name: `Player-R0C${col}`,
			});
			expect(data).toBe(true);
		}

		// Claim remaining 90 via batch (rows 1-9)
		for (let row = 1; row < 10; row++) {
			const cells = Array.from({ length: 10 }, (_, col) => ({ row, col }));
			const { data } = await client.rpc('claim_squares_batch', {
				p_party_id: party.id,
				p_player_name: `Player-R${row}`,
				p_cells: cells,
			});
			expect(data).toBe(10);
		}

		// Verify all 100 are claimed
		const { data: claimed } = await client
			.from('squares')
			.select('id')
			.eq('party_id', party.id)
			.not('player_name', 'is', null);

		expect(claimed).toHaveLength(100);

		// ─── Step 3: Lock party ───
		const { data: locked } = await client.rpc('lock_party', {
			p_party_id: party.id,
			p_pin: party.host_pin,
		});

		expect(locked).toBe(true);

		// Verify status → active
		const { data: activeParty } = await client
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();

		expect(activeParty?.status).toBe('active');

		// Verify numbers generated
		const { data: numbers } = await client
			.from('numbers')
			.select('row_numbers, col_numbers')
			.eq('party_id', party.id)
			.single();

		expect(numbers?.row_numbers).toHaveLength(10);
		expect(numbers?.col_numbers).toHaveLength(10);

		// ─── Step 4: Enter Q1 score ───
		const { data: q1Result } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q1',
			p_row_score: 7,
			p_col_score: 3,
		});

		expect(q1Result).toBe(true);

		// Verify winner exists for Q1
		const { data: q1Winner } = await client
			.from('winners')
			.select('player_name, amount')
			.eq('party_id', party.id)
			.eq('quarter', 'q1')
			.single();

		expect(q1Winner).not.toBeNull();
		expect(q1Winner?.player_name).toBeTruthy();
		// Prize = (2 * 100) * 25 / 100 = 50
		expect(Number(q1Winner?.amount)).toBe(50);

		// ─── Step 5: Enter Q2, Q3 scores ───
		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q2',
			p_row_score: 14,
			p_col_score: 10,
		});

		await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'q3',
			p_row_score: 21,
			p_col_score: 17,
		});

		// ─── Step 6: Enter final score → status becomes 'complete' ───
		const { data: finalResult } = await client.rpc('update_score', {
			p_party_id: party.id,
			p_pin: party.host_pin,
			p_quarter: 'final',
			p_row_score: 28,
			p_col_score: 24,
		});

		expect(finalResult).toBe(true);

		// Verify status → complete
		const { data: completeParty } = await client
			.from('parties')
			.select('status')
			.eq('id', party.id)
			.single();

		expect(completeParty?.status).toBe('complete');

		// Verify all 4 winners exist
		const { data: allWinners } = await client
			.from('winners')
			.select('quarter')
			.eq('party_id', party.id);

		expect(allWinners).toHaveLength(4);
		const quarters = allWinners?.map((w) => w.quarter).sort();
		expect(quarters).toEqual(['final', 'q1', 'q2', 'q3']);

		// ─── Step 7: Delete party → cascade cleanup ───
		const partyId = party.id;

		const { data: deleted } = await client.rpc('delete_party', {
			p_party_id: partyId,
			p_pin: party.host_pin,
		});

		expect(deleted).toBe(true);

		// Verify everything is gone
		const { data: gonePty } = await client
			.from('parties')
			.select('id')
			.eq('id', partyId)
			.maybeSingle();
		expect(gonePty).toBeNull();

		const { data: goneSquares } = await client.from('squares').select('id').eq('party_id', partyId);
		expect(goneSquares).toHaveLength(0);

		const { data: goneNumbers } = await client
			.from('numbers')
			.select('party_id')
			.eq('party_id', partyId);
		expect(goneNumbers).toHaveLength(0);

		const { data: goneScores } = await client
			.from('scores')
			.select('party_id')
			.eq('party_id', partyId);
		expect(goneScores).toHaveLength(0);

		const { data: goneWinners } = await client.from('winners').select('id').eq('party_id', partyId);
		expect(goneWinners).toHaveLength(0);
	});
});
