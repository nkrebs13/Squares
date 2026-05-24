import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanupParty, ensureSupabaseReady, getServiceRoleClient, getTestClient } from './helpers';

const client = getTestClient();
const service = getServiceRoleClient();
const createdPartyIds: string[] = [];
const createdGameIds: string[] = [];

async function createParty({
	rowName = 'Eagles',
	colName = 'Chiefs',
}: {
	rowName?: string;
	colName?: string;
} = {}) {
	const { data, error } = await client.rpc('create_party', {
		p_host_name: 'Test Host',
		p_pin: '1234',
		p_square_price: 1,
		p_split_q1: 25,
		p_split_q2: 25,
		p_split_q3: 25,
		p_split_final: 25,
		p_team_row_name: rowName,
		p_team_col_name: colName,
		p_team_row_color: '#004C54',
		p_team_col_color: '#E31837',
		p_event_name: 'RLS Test Game',
		p_kickoff_at: null,
	});

	if (error) throw new Error(`create_party failed: ${error.message}`);
	createdPartyIds.push(data.id);
	return data;
}

describe('party update RLS hardening', () => {
	beforeAll(async () => {
		await ensureSupabaseReady();
	});

	afterEach(async () => {
		while (createdPartyIds.length > 0) {
			const partyId = createdPartyIds.pop();
			if (partyId) await cleanupParty(client, partyId);
		}
		while (createdGameIds.length > 0) {
			const gameId = createdGameIds.pop();
			if (gameId) await service.from('game_scores').delete().eq('game_id', gameId);
		}
	});

	it('blocks direct anon updates to party rows', async () => {
		const party = await createParty();

		const { error } = await client
			.from('parties')
			.update({ split_q1: 10, split_q2: 20, split_q3: 30, split_final: 40 })
			.eq('id', party.id)
			.select('id');

		expect(error).toBeTruthy();
		expect(error?.message ?? '').toMatch(/permission|policy|rls|violates/i);

		const { data: persisted, error: readError } = await service
			.from('parties')
			.select('split_q1, split_q2, split_q3, split_final')
			.eq('id', party.id)
			.single();
		expect(readError).toBeNull();
		expect(persisted).toEqual({ split_q1: 25, split_q2: 25, split_q3: 25, split_final: 25 });
	});

	it('does not expose host PIN columns through public party reads', async () => {
		const party = await createParty();

		const { data, error } = await client
			.from('parties')
			.select('id, code, host_pin')
			.eq('id', party.id)
			.single();

		expect(data).toBeNull();
		expect(error).toBeTruthy();
		expect(error?.message ?? '').toMatch(/permission|host_pin/i);
	});

	it('blocks direct anon writes to squares while preserving claim RPCs', async () => {
		const party = await createParty();

		const { error: directError } = await client
			.from('squares')
			.update({ player_name: 'Mallory', claimed_at: new Date().toISOString() })
			.eq('party_id', party.id)
			.eq('row_num', 0)
			.eq('col_num', 0);

		expect(directError).toBeTruthy();

		const { data: claimed, error: claimError } = await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});

		expect(claimError).toBeNull();
		expect(claimed).toBe(true);
	});

	it('allows host PIN RPC to remove a player without direct square update rights', async () => {
		const party = await createParty();

		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 0,
			p_player_name: 'Alice',
		});
		await client.rpc('claim_square', {
			p_party_id: party.id,
			p_row: 0,
			p_col: 1,
			p_player_name: 'Alice',
		});

		const { data: wrongPinData, error: wrongPinError } = await client.rpc('remove_player', {
			p_party_id: party.id,
			p_pin: '9999',
			p_player_name_lower: 'alice',
		});
		expect(wrongPinData).toBeNull();
		expect(wrongPinError).toBeTruthy();

		const { data: removedCount, error } = await client.rpc('remove_player', {
			p_party_id: party.id,
			p_pin: '1234',
			p_player_name_lower: 'alice',
		});

		expect(error).toBeNull();
		expect(removedCount).toBe(2);
	});

	it('allows payout updates only through the host PIN RPC', async () => {
		const party = await createParty();

		const { data: wrongPinData, error: wrongPinError } = await client.rpc(
			'update_payout_structure',
			{
				p_party_id: party.id,
				p_pin: '9999',
				p_split_q1: 10,
				p_split_q2: 20,
				p_split_q3: 30,
				p_split_final: 40,
			}
		);
		expect(wrongPinData).toBeNull();
		expect(wrongPinError).toBeTruthy();

		const { data: updated, error } = await client.rpc('update_payout_structure', {
			p_party_id: party.id,
			p_pin: '1234',
			p_split_q1: 10,
			p_split_q2: 20,
			p_split_q3: 30,
			p_split_final: 40,
		});

		expect(error).toBeNull();
		expect(updated.split_q1).toBe(10);
		expect(updated.split_q2).toBe(20);
		expect(updated.split_q3).toBe(30);
		expect(updated.split_final).toBe(40);
	});

	it('syncs home_team_is_row from server-owned game data without broad update RLS', async () => {
		const party = await createParty();
		const gameId = `rls-${Date.now()}`;
		createdGameIds.push(gameId);

		const { error: gameError } = await service.from('game_scores').insert({
			game_id: gameId,
			sport: 'nfl',
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
			home_score: 0,
			away_score: 0,
			game_clock: '',
			game_quarter: 0,
			game_status: 'pregame',
		});
		expect(gameError).toBeNull();

		const { error: setupError } = await service
			.from('parties')
			.update({ game_id: gameId, home_team_is_row: false })
			.eq('id', party.id);
		expect(setupError).toBeNull();

		const { data: synced, error } = await client.rpc('sync_party_home_team_mapping', {
			p_party_id: party.id,
		});

		expect(error).toBeNull();
		expect(synced.home_team_is_row).toBe(true);
		expect(synced.host_pin).toBeUndefined();
	});

	it('treats wildcard characters in team names as literals when syncing mapping', async () => {
		const party = await createParty({ rowName: 'Eagles%', colName: 'Chiefs' });
		const gameId = `wild${Date.now() % 1_000_000_000}`;
		createdGameIds.push(gameId);

		const { error: gameError } = await service.from('game_scores').insert({
			game_id: gameId,
			sport: 'nfl',
			home_team_abbrev: 'PHI',
			away_team_abbrev: 'KC',
			home_team_name: 'Philadelphia Eagles',
			away_team_name: 'Kansas City Chiefs',
			home_score: 0,
			away_score: 0,
			game_clock: '',
			game_quarter: 0,
			game_status: 'pregame',
		});
		expect(gameError).toBeNull();

		const { error: setupError } = await service
			.from('parties')
			.update({ game_id: gameId, home_team_is_row: false })
			.eq('id', party.id);
		expect(setupError).toBeNull();

		const { data: synced, error } = await client.rpc('sync_party_home_team_mapping', {
			p_party_id: party.id,
		});

		expect(error).toBeNull();
		expect(synced.home_team_is_row).toBe(false);
	});
});
