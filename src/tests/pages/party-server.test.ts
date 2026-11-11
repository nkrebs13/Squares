import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockEnv = vi.hoisted(() => ({
	env: {
		SUPABASE_URL: 'https://example.supabase.co',
		SUPABASE_ANON_KEY: 'anon-key',
	} as Record<string, string | undefined>,
}));

const supabaseMocks = vi.hoisted(() => {
	const rpc = vi.fn();
	const createClient = vi.fn(() => ({ rpc }));
	return { createClient, rpc };
});

vi.mock('$env/dynamic/private', () => mockEnv);
vi.mock('@supabase/supabase-js', () => ({
	createClient: supabaseMocks.createClient,
}));

import { load } from '../../routes/party/[code]/+page.server';
import { createMockParty } from '../factories';

describe('/party/[code] server load', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockEnv.env.SUPABASE_URL = 'https://example.supabase.co';
		mockEnv.env.SUPABASE_ANON_KEY = 'anon-key';
		mockEnv.env.VITE_SUPABASE_URL = undefined;
		mockEnv.env.VITE_SUPABASE_ANON_KEY = undefined;
	});

	it('loads public party metadata for server-rendered share tags', async () => {
		supabaseMocks.rpc.mockResolvedValueOnce({
			data: {
				party: createMockParty({
					code: 'BOWL27',
					event_name: '2027 Super Bowl',
					kickoff_at: '2027-02-14T23:30:00.000Z',
					status: 'filling',
					team_row_name: 'Chiefs',
					team_col_name: 'Eagles',
				}),
				filled_count: 0,
			},
			error: null,
		});

		const result = await load({ params: { code: 'bowl-27' } } as never);

		expect(supabaseMocks.createClient).toHaveBeenCalledWith(
			'https://example.supabase.co',
			'anon-key',
			expect.objectContaining({
				auth: expect.objectContaining({
					persistSession: false,
					autoRefreshToken: false,
				}),
			})
		);
		expect(supabaseMocks.rpc).toHaveBeenCalledWith('get_party_preview', { p_code: 'BOWL27' });
		expect(result).toEqual({
			partyMeta: {
				code: 'BOWL27',
				eventName: '2027 Super Bowl',
				kickoffAt: '2027-02-14T23:30:00.000Z',
				status: 'filling',
				teamRowName: 'Chiefs',
				teamColName: 'Eagles',
			},
		});
	});

	it('keeps the party route available when server metadata cannot load', async () => {
		supabaseMocks.rpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'network timeout' },
		});

		const result = await load({ params: { code: 'BOWL27' } } as never);

		expect(result).toEqual({ partyMeta: null });
	});

	it('falls back to existing VITE Supabase env vars for local compatibility', async () => {
		mockEnv.env.SUPABASE_URL = undefined;
		mockEnv.env.SUPABASE_ANON_KEY = undefined;
		mockEnv.env.VITE_SUPABASE_URL = 'https://vite.example.supabase.co';
		mockEnv.env.VITE_SUPABASE_ANON_KEY = 'vite-anon-key';
		supabaseMocks.rpc.mockResolvedValueOnce({ data: null, error: null });

		await load({ params: { code: 'BOWL27' } } as never);

		expect(supabaseMocks.createClient).toHaveBeenCalledWith(
			'https://vite.example.supabase.co',
			'vite-anon-key',
			expect.any(Object)
		);
	});

	it('skips the server query when Supabase env vars are unavailable', async () => {
		mockEnv.env.SUPABASE_URL = undefined;
		mockEnv.env.SUPABASE_ANON_KEY = undefined;
		mockEnv.env.VITE_SUPABASE_URL = undefined;
		mockEnv.env.VITE_SUPABASE_ANON_KEY = undefined;

		const result = await load({ params: { code: 'BOWL27' } } as never);

		expect(result).toEqual({ partyMeta: null });
		expect(supabaseMocks.createClient).not.toHaveBeenCalled();
	});
});
