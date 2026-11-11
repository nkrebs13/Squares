import { describe, it, expect, beforeEach } from 'vitest';
import { fetchPartyPreview } from '$lib/services/partyPreview';
import { mockSupabaseClient } from '../setup';
import { createMockParty } from '../factories';

describe('fetchPartyPreview', () => {
	beforeEach(() => {
		mockSupabaseClient.rpc.mockReset();
	});

	it('returns the party and its claimed-square count from one call', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: { party: createMockParty({ code: 'ABC123' }), filled_count: 37 },
			error: null,
		});

		const preview = await fetchPartyPreview('abc123');

		expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('get_party_preview', { p_code: 'abc123' });
		expect(preview?.party.code).toBe('ABC123');
		expect(preview?.filledCount).toBe(37);
	});

	it('returns null when no party has the code', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({ data: null, error: null });
		expect(await fetchPartyPreview('NOPE00')).toBeNull();
	});

	it('returns null for a malformed party row', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: { party: { id: 'x' }, filled_count: 0 },
			error: null,
		});
		expect(await fetchPartyPreview('ABC123')).toBeNull();
	});

	it('throws when the request fails, so the page can say so', async () => {
		mockSupabaseClient.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'TypeError: Failed to fetch' },
		});
		await expect(fetchPartyPreview('ABC123')).rejects.toThrow('Failed to fetch');
	});
});
