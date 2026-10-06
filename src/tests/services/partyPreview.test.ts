import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockParty } from '../factories';

type QueryResult = { data: unknown; error: unknown };

const mockFrom = vi.fn();
vi.mock('$lib/supabase', () => ({
	getSupabaseClient: () => ({ from: mockFrom }),
}));

import {
	fetchJoinTarget,
	fetchPartyPreview,
	PREVIEW_NOT_FOUND_ERROR,
} from '$lib/services/partyPreview';

/** `from(table).select().eq().single()` chain resolving to `result`. */
function singleChain(result: QueryResult) {
	const single = vi.fn().mockResolvedValue(result);
	const eq = vi.fn().mockReturnValue({ single });
	const select = vi.fn().mockReturnValue({ eq });
	return { select, eq, single };
}

/** `from(table).select().eq()` chain (no `.single()`) resolving to `result`. */
function listChain(result: QueryResult) {
	const eq = vi.fn().mockResolvedValue(result);
	const select = vi.fn().mockReturnValue({ eq });
	return { select, eq };
}

describe('fetchPartyPreview', () => {
	beforeEach(() => {
		mockFrom.mockReset();
	});

	it('maps the party row and counts claimed squares', async () => {
		const party = createMockParty({ id: 'party-1', event_name: 'Big Game', square_price: 5 });
		const parties = singleChain({ data: party, error: null });
		const squares = listChain({
			data: [
				{ player_name: 'Ann', claimed_at: '2026-01-01T00:00:00Z' },
				{ player_name: null, claimed_at: '2026-01-01T00:00:00Z' },
				{ player_name: null, claimed_at: null },
			],
			error: null,
		});
		mockFrom.mockReturnValueOnce(parties).mockReturnValueOnce(squares);

		const result = await fetchPartyPreview('ABC123');

		expect(mockFrom).toHaveBeenNthCalledWith(1, 'parties');
		expect(mockFrom).toHaveBeenNthCalledWith(2, 'squares');
		expect(parties.eq).toHaveBeenCalledWith('code', 'ABC123');
		expect(squares.eq).toHaveBeenCalledWith('party_id', 'party-1');
		expect(result).toEqual({
			ok: true,
			preview: {
				id: 'party-1',
				eventName: 'Big Game',
				kickoffAt: party.kickoff_at,
				status: party.status,
				teamRowName: party.team_row_name,
				teamColName: party.team_col_name,
				squarePrice: 5,
				splitQ1: party.split_q1,
				splitQ2: party.split_q2,
				splitQ3: party.split_q3,
				splitFinal: party.split_final,
				filledCount: 2,
			},
		});
	});

	it('returns filledCount null when the squares query fails', async () => {
		mockFrom
			.mockReturnValueOnce(singleChain({ data: createMockParty(), error: null }))
			.mockReturnValueOnce(listChain({ data: null, error: { message: 'boom' } }));

		const result = await fetchPartyPreview('ABC123');

		expect(result.ok && result.preview.filledCount).toBeNull();
	});

	it('returns a not-found error when no party matches', async () => {
		mockFrom.mockReturnValueOnce(
			singleChain({ data: null, error: { code: 'PGRST116', message: 'no rows' } })
		);

		const result = await fetchPartyPreview('ZZZZZZ');

		expect(result).toEqual({ ok: false, error: PREVIEW_NOT_FOUND_ERROR });
		expect(mockFrom).toHaveBeenCalledTimes(1);
	});

	it('returns not-found when the party query errors even if data is present', async () => {
		mockFrom.mockReturnValueOnce(
			singleChain({ data: createMockParty(), error: { message: 'query failed' } })
		);

		const result = await fetchPartyPreview('ABC123');

		expect(result).toEqual({ ok: false, error: PREVIEW_NOT_FOUND_ERROR });
	});

	it('skips the squares query when the request went stale', async () => {
		mockFrom.mockReturnValueOnce(singleChain({ data: createMockParty(), error: null }));

		const result = await fetchPartyPreview('ABC123', () => true);

		expect(result.ok).toBe(false);
		expect(mockFrom).toHaveBeenCalledTimes(1);
	});

	it('propagates thrown network errors', async () => {
		mockFrom.mockImplementationOnce(() => {
			throw new Error('network down');
		});

		await expect(fetchPartyPreview('ABC123')).rejects.toThrow('network down');
	});
});

describe('fetchJoinTarget', () => {
	beforeEach(() => {
		mockFrom.mockReset();
	});

	it('returns the camelCased join fields', async () => {
		const chain = singleChain({
			data: { id: 'party-1', status: 'filling', host_name_lower: 'nathan' },
			error: null,
		});
		mockFrom.mockReturnValueOnce(chain);

		const result = await fetchJoinTarget('ABC123');

		expect(mockFrom).toHaveBeenCalledWith('parties');
		expect(chain.select).toHaveBeenCalledWith('id, status, host_name_lower');
		expect(chain.eq).toHaveBeenCalledWith('code', 'ABC123');
		expect(result).toEqual({ id: 'party-1', status: 'filling', hostNameLower: 'nathan' });
	});

	it('returns null when the party is not found', async () => {
		mockFrom.mockReturnValueOnce(singleChain({ data: null, error: { message: 'no rows' } }));

		expect(await fetchJoinTarget('ZZZZZZ')).toBeNull();
	});

	it('returns null when the query errors', async () => {
		mockFrom.mockReturnValueOnce(
			singleChain({
				data: { id: 'x', status: 'filling', host_name_lower: null },
				error: { message: 'e' },
			})
		);

		expect(await fetchJoinTarget('ABC123')).toBeNull();
	});
});
