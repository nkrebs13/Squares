import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('$lib/supabase', () => ({
	getSupabaseClient: () => ({ rpc: mockRpc }),
}));

import { createParty } from '$lib/services/createParty';
import { DEFAULT_TEAMS } from '$lib/types';

const validPartyRow = {
	id: '11111111-1111-1111-1111-111111111111',
	code: 'AB12CD',
	host_name_lower: 'nathan',
	square_price: 1.0,
	split_q1: 25,
	split_q2: 25,
	split_q3: 25,
	split_final: 25,
	status: 'filling',
	team_row_name: DEFAULT_TEAMS.row.name,
	team_col_name: DEFAULT_TEAMS.col.name,
	team_row_color: DEFAULT_TEAMS.row.color,
	team_col_color: DEFAULT_TEAMS.col.color,
	created_at: '2026-04-26T00:00:00Z',
	updated_at: '2026-04-26T00:00:00Z',
	expires_at: '2026-05-26T00:00:00Z',
	game_id: null,
	home_team_is_row: null,
};

const validInput = {
	hostName: 'Nathan',
	hostPin: '1234',
	squarePrice: 1.0,
	splits: { q1: 25, q2: 25, q3: 25, final: 25 },
};

describe('createParty service', () => {
	beforeEach(() => {
		mockRpc.mockReset();
	});

	it('forwards inputs to the create_party RPC and returns the typed party on success', async () => {
		mockRpc.mockResolvedValueOnce({ data: validPartyRow, error: null });

		const result = await createParty(validInput);

		expect(mockRpc).toHaveBeenCalledWith('create_party', {
			p_host_name: 'Nathan',
			p_pin: '1234',
			p_square_price: 1.0,
			p_split_q1: 25,
			p_split_q2: 25,
			p_split_q3: 25,
			p_split_final: 25,
			p_team_row_name: DEFAULT_TEAMS.row.name,
			p_team_col_name: DEFAULT_TEAMS.col.name,
			p_team_row_color: DEFAULT_TEAMS.row.color,
			p_team_col_color: DEFAULT_TEAMS.col.color,
		});

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.party.code).toBe('AB12CD');
			expect(result.party.status).toBe('filling');
		}
	});

	it('humanizes RPC error: PIN format', async () => {
		mockRpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'PIN must be exactly 4 digits' },
		});
		const result = await createParty({ ...validInput, hostPin: 'abc' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/4 digits/i);
	});

	it('humanizes RPC error: split sum', async () => {
		mockRpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'splits must sum to exactly 100 (got 110)' },
		});
		const result = await createParty(validInput);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/total 100/i);
	});

	it('humanizes RPC error: empty host name', async () => {
		mockRpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'host_name must be non-empty after trim' },
		});
		const result = await createParty({ ...validInput, hostName: '' });
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/host name/i);
	});

	it('humanizes RPC error: code-collision exhaustion', async () => {
		mockRpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'failed to generate unique party code after 5 attempts' },
		});
		const result = await createParty(validInput);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/unique party code/i);
	});

	it('returns an error if the RPC succeeds but the payload shape is invalid', async () => {
		mockRpc.mockResolvedValueOnce({
			data: { id: 'partial' }, // missing all required fields
			error: null,
		});
		const result = await createParty(validInput);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toMatch(/unexpected shape/i);
	});

	it('falls back to generic message for unrecognized RPC errors', async () => {
		mockRpc.mockResolvedValueOnce({
			data: null,
			error: { message: 'connection refused' },
		});
		const result = await createParty(validInput);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toBe('connection refused');
	});
});
