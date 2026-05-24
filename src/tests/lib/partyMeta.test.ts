import { describe, expect, it } from 'vitest';
import {
	buildPartyCanonicalUrl,
	buildPartyPageTitle,
	buildPartyShareDescription,
	partyToShareMetadata,
	type PartyShareMetadata,
} from '$lib/partyMeta';
import type { Party } from '$lib/types';

const meta: PartyShareMetadata = {
	code: 'BOWL27',
	eventName: '2027 Super Bowl',
	kickoffAt: null,
	status: 'filling',
	teamRowName: 'Chiefs',
	teamColName: 'Eagles',
};

describe('partyMeta', () => {
	it('builds specific titles for shared party links', () => {
		expect(buildPartyPageTitle(meta)).toBe('Football Squares — 2027 Super Bowl: Chiefs vs Eagles');
	});

	it('builds status-aware share descriptions', () => {
		expect(buildPartyShareDescription(meta)).toBe(
			'Join 2027 Super Bowl: Chiefs vs Eagles football squares. Claim squares before kickoff and track winners quarter by quarter in real time.'
		);

		expect(buildPartyShareDescription({ ...meta, status: 'active' })).toContain(
			'Follow scores and quarter winners in real time.'
		);
		expect(buildPartyShareDescription({ ...meta, status: 'complete' })).toContain(
			'See final scores, winners, and payouts.'
		);
	});

	it('falls back to generic app metadata when party metadata is unavailable', () => {
		expect(buildPartyPageTitle(null)).toBe('Football Squares');
		expect(buildPartyShareDescription(null)).toMatch(/Real-time football squares pools/);
	});

	it('builds canonical party URLs from app config', () => {
		expect(buildPartyCanonicalUrl('BOWL27')).toBe('https://squares.nathankrebs.com/party/BOWL27');
	});

	it('maps party rows without leaking host-only fields', () => {
		const party = {
			id: 'party-id',
			code: 'BOWL27',
			host_pin: '1234',
			host_name_lower: 'host',
			event_name: '2027 Super Bowl',
			kickoff_at: null,
			square_price: 5,
			split_q1: 10,
			split_q2: 20,
			split_q3: 30,
			split_final: 40,
			status: 'filling',
			team_row_name: 'Chiefs',
			team_col_name: 'Eagles',
			team_row_color: '#E31837',
			team_col_color: '#004C54',
			created_at: '2026-01-01T00:00:00.000Z',
			updated_at: '2026-01-01T00:00:00.000Z',
			expires_at: '2027-02-21T00:00:00.000Z',
			game_id: null,
			home_team_is_row: null,
		} satisfies Party;

		expect(partyToShareMetadata(party)).toEqual(meta);
	});
});
