import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { cleanupParty, ensureSupabaseReady, getTestClient } from './helpers';

const client = getTestClient();
const createdPartyIds: string[] = [];

async function createParty() {
	const { data, error } = await client.rpc('create_party', {
		p_host_name: 'Test Host',
		p_pin: '1234',
		p_square_price: 1,
		p_split_q1: 25,
		p_split_q2: 25,
		p_split_q3: 25,
		p_split_final: 25,
		p_team_row_name: 'Eagles',
		p_team_col_name: 'Chiefs',
		p_team_row_color: '#004C54',
		p_team_col_color: '#E31837',
		p_event_name: 'Original Game',
		p_kickoff_at: null,
	});

	if (error) throw new Error(`create_party failed: ${error.message}`);
	createdPartyIds.push(data.id);
	return data;
}

describe('update_party_details RPC', () => {
	beforeAll(async () => {
		await ensureSupabaseReady();
	});

	afterEach(async () => {
		while (createdPartyIds.length > 0) {
			const partyId = createdPartyIds.pop();
			if (partyId) await cleanupParty(client, partyId);
		}
	});

	it('lets the host update event identity while the party is filling', async () => {
		const party = await createParty();
		const kickoffAt = '2027-02-14T23:30:00.000Z';

		const { data: updated, error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: '2027 Championship',
			p_kickoff_at: kickoffAt,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeNull();
		expect(updated.event_name).toBe('2027 Championship');
		expect(updated.kickoff_at).toBeTruthy();
		expect(updated.team_row_name).toBe('Ravens');
		expect(updated.team_col_name).toBe('Lions');
		expect(updated.team_row_color).toBe('#241773');
		expect(updated.team_col_color).toBe('#0076B6');

		const expiresAt = new Date(updated.expires_at);
		const twoWeeksAfterKickoff = new Date(kickoffAt);
		twoWeeksAfterKickoff.setDate(twoWeeksAfterKickoff.getDate() + 14);
		expect(expiresAt.getTime()).toBeGreaterThanOrEqual(twoWeeksAfterKickoff.getTime());
	});

	it('rejects edits with the wrong host PIN', async () => {
		const party = await createParty();

		const { error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '9999',
			p_event_name: 'Wrong Pin Edit',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeTruthy();
		expect(error?.message).toMatch(/invalid party or PIN/i);
	});

	it('rejects edits after the grid is locked', async () => {
		const party = await createParty();
		const { error: statusError } = await client
			.from('parties')
			.update({ status: 'active' })
			.eq('id', party.id);
		expect(statusError).toBeNull();

		const { error } = await client.rpc('update_party_details', {
			p_party_id: party.id,
			p_pin: '1234',
			p_event_name: 'Late Edit',
			p_kickoff_at: null,
			p_team_row_name: 'Ravens',
			p_team_col_name: 'Lions',
			p_team_row_color: '#241773',
			p_team_col_color: '#0076B6',
		});

		expect(error).toBeTruthy();
		expect(error?.message).toMatch(/before the grid is locked/i);
	});
});
