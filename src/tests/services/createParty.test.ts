import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockRpc = vi.fn();
vi.mock('$lib/supabase', () => ({
	getSupabaseClient: () => ({ rpc: mockRpc }),
}));

import { createParty } from '$lib/services/createParty';
import { APP_CONFIG, DEFAULT_TEAMS } from '$lib/config';

const validPartyRow = {
	id: '11111111-1111-1111-1111-111111111111',
	code: 'AB12CD',
	host_name_lower: 'nathan',
	event_name: 'Test Football Squares',
	kickoff_at: null,
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
	eventName: '2027 Super Bowl',
	kickoffAt: '2027-02-14T23:30:00.000Z',
	hostName: 'Nathan',
	hostPin: '1234',
	squarePrice: 1.0,
	splits: { q1: 25, q2: 25, q3: 25, final: 25 },
	teams: { row: DEFAULT_TEAMS.row, col: DEFAULT_TEAMS.col },
};

describe('createParty service', () => {
	beforeEach(() => {
		mockRpc.mockReset();
	});

	it('sends every value to host_create_party and returns the typed party', async () => {
		mockRpc.mockResolvedValueOnce({ data: { ok: true, party: validPartyRow }, error: null });

		const result = await createParty(validInput);

		expect(mockRpc).toHaveBeenCalledWith('host_create_party', {
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
			p_event_name: '2027 Super Bowl',
			p_kickoff_at: '2027-02-14T23:30:00.000Z',
		});
		expect(result).toEqual({ ok: true, party: expect.objectContaining({ code: 'AB12CD' }) });
	});

	it('sends the configured default event name for a blank one', async () => {
		mockRpc.mockResolvedValueOnce({ data: { ok: true, party: validPartyRow }, error: null });

		await createParty({ ...validInput, eventName: '   ' });

		expect(mockRpc.mock.calls[0][1].p_event_name).toBe(APP_CONFIG.defaultEventName);
	});

	it.each([
		['host_name', 'Please enter a host name.'],
		['pin', 'PIN must be exactly 4 digits.'],
		['square_price', 'Square price must be greater than 0.'],
		['splits', 'Each split must be 0–100% and they must add up to 100%.'],
		['event_name', 'Event name must be 1–80 characters.'],
		['team_name', 'Team names cannot be blank.'],
		['teams', 'Choose two different teams for the matchup.'],
		['team_color', 'Team colors must be valid hex colors.'],
	])('shows the copy for an invalid %s', async (field, copy) => {
		mockRpc.mockResolvedValueOnce({
			data: { ok: false, error: 'invalid_input', field },
			error: null,
		});

		expect(await createParty(validInput)).toEqual({ ok: false, error: copy });
	});

	it('shows the generic copy when the request fails', async () => {
		mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'TypeError: Failed to fetch' } });

		expect(await createParty(validInput)).toEqual({
			ok: false,
			error: 'Failed to create party. Please try again.',
		});
	});

	it('returns an error if the party in the response has an invalid shape', async () => {
		mockRpc.mockResolvedValueOnce({ data: { ok: true, party: { id: 'x' } }, error: null });

		const result = await createParty(validInput);

		expect(result.ok).toBe(false);
	});
});
