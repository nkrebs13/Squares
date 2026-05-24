import { describe, it, expect, afterEach, beforeAll } from 'vitest';
import { getTestClient, ensureSupabaseReady, cleanupParty } from './helpers';
import type { SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient;
const createdPartyIds: string[] = [];

beforeAll(async () => {
	await ensureSupabaseReady();
	client = getTestClient();
});

afterEach(async () => {
	while (createdPartyIds.length > 0) {
		const id = createdPartyIds.pop();
		if (id) await cleanupParty(client, id);
	}
});

const validArgs = {
	p_event_name: '2027 Super Bowl',
	p_kickoff_at: '2027-02-14T23:30:00.000Z',
	p_host_name: 'Nathan',
	p_pin: '1234',
	p_square_price: 1.0,
	p_split_q1: 25,
	p_split_q2: 25,
	p_split_q3: 25,
	p_split_final: 25,
};

describe('create_party RPC', () => {
	it('happy path — returns the new party row with a unique 6-char code', async () => {
		const { data, error } = await client.rpc('create_party', validArgs);

		expect(error).toBeNull();
		expect(data).toBeTruthy();
		const party = data as Record<string, unknown>;
		expect(party.id).toMatch(/^[0-9a-f-]{36}$/i);
		expect(party.code).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
		expect(party.status).toBe('filling');
		expect(party.event_name).toBe('2027 Super Bowl');
		expect(party.kickoff_at).toBeTruthy();
		expect(party.host_pin).toBe('1234');
		expect(party.host_name_lower).toBe('nathan');

		createdPartyIds.push(party.id as string);
	});

	it('rejects splits that do not sum to 100', async () => {
		const { data, error } = await client.rpc('create_party', {
			...validArgs,
			p_split_q1: 50,
			p_split_q2: 25,
			p_split_q3: 25,
			p_split_final: 25, // sum = 125
		});

		expect(data).toBeNull();
		expect(error).toBeTruthy();
		expect(error?.message ?? '').toMatch(/sum to exactly 100/i);
	});

	it('rejects PINs that are not exactly 4 digits', async () => {
		for (const badPin of ['12', '12345', 'abcd', '12a4', '']) {
			const { data, error } = await client.rpc('create_party', {
				...validArgs,
				p_pin: badPin,
			});
			expect(data, `bad PIN "${badPin}" should be rejected`).toBeNull();
			expect(error, `bad PIN "${badPin}" should produce an error`).toBeTruthy();
			expect(error?.message ?? '').toMatch(/4 digits/i);
		}
	});

	it('rejects non-positive square_price', async () => {
		for (const badPrice of [0, -1, -0.5]) {
			const { data, error } = await client.rpc('create_party', {
				...validArgs,
				p_square_price: badPrice,
			});
			expect(data, `price ${badPrice} should be rejected`).toBeNull();
			expect(error, `price ${badPrice} should produce an error`).toBeTruthy();
		}
	});

	it('produces a different code on each successive call (retry path is exercised statistically)', async () => {
		// The RPC retries up to 5 times on UNIQUE collision. Two back-to-back calls
		// will almost always pick different codes (32^6 alphabet); this smoke test
		// proves successive calls are independent and the retry mechanism doesn't
		// degrade behaviour for the common case.
		const { data: first } = await client.rpc('create_party', validArgs);
		expect(first).toBeTruthy();
		const firstParty = first as Record<string, unknown>;
		createdPartyIds.push(firstParty.id as string);

		const { data: second, error: secondError } = await client.rpc('create_party', validArgs);
		expect(secondError).toBeNull();
		expect(second).toBeTruthy();
		const secondParty = second as Record<string, unknown>;
		expect(secondParty.code).not.toBe(firstParty.code);
		createdPartyIds.push(secondParty.id as string);
	});

	it('inserts exactly 100 squares for the new party', async () => {
		const { data: party } = await client.rpc('create_party', validArgs);
		const partyRow = party as Record<string, unknown>;
		createdPartyIds.push(partyRow.id as string);

		const { data: squares, error } = await client
			.from('squares')
			.select('row_num, col_num')
			.eq('party_id', partyRow.id);

		expect(error).toBeNull();
		expect(squares).toHaveLength(100);

		// Confirm full 10x10 coverage with no duplicates
		const seen = new Set((squares ?? []).map((s) => `${s.row_num}-${s.col_num}`));
		expect(seen.size).toBe(100);
		for (let r = 0; r < 10; r++) {
			for (let c = 0; c < 10; c++) {
				expect(seen.has(`${r}-${c}`)).toBe(true);
			}
		}
	});

	it('inserts a scores row for the new party with all quarter scores null', async () => {
		const { data: party } = await client.rpc('create_party', validArgs);
		const partyRow = party as Record<string, unknown>;
		createdPartyIds.push(partyRow.id as string);

		const { data: scores, error } = await client
			.from('scores')
			.select('*')
			.eq('party_id', partyRow.id)
			.single();

		expect(error).toBeNull();
		expect(scores).toBeTruthy();
		const scoresRow = scores as Record<string, unknown>;
		expect(scoresRow.q1_row_score).toBeNull();
		expect(scoresRow.q1_col_score).toBeNull();
		expect(scoresRow.q2_row_score).toBeNull();
		expect(scoresRow.q2_col_score).toBeNull();
		expect(scoresRow.q3_row_score).toBeNull();
		expect(scoresRow.q3_col_score).toBeNull();
		expect(scoresRow.final_row_score).toBeNull();
		expect(scoresRow.final_col_score).toBeNull();
	});

	it('trims and lowercases host_name when storing host_name_lower', async () => {
		const { data: party } = await client.rpc('create_party', {
			...validArgs,
			p_host_name: '  NATHAN  ',
		});
		expect(party).toBeTruthy();
		const partyRow = party as Record<string, unknown>;
		expect(partyRow.host_name_lower).toBe('nathan');
		createdPartyIds.push(partyRow.id as string);
	});

	it('defaults blank event_name to a usable title', async () => {
		const { data: party, error } = await client.rpc('create_party', {
			...validArgs,
			p_event_name: '   ',
		});
		expect(error).toBeNull();
		expect(party).toBeTruthy();
		const partyRow = party as Record<string, unknown>;
		expect(partyRow.event_name).toBe('Football Squares');
		createdPartyIds.push(partyRow.id as string);
	});

	it('rejects empty host_name (after trim)', async () => {
		const { data, error } = await client.rpc('create_party', {
			...validArgs,
			p_host_name: '   ',
		});
		expect(data).toBeNull();
		expect(error).toBeTruthy();
		expect(error?.message ?? '').toMatch(/host_name/i);
	});
});
