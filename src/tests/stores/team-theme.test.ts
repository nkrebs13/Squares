import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import { cleanup, party, teamTheme } from '$lib/stores/game';
import { DEFAULT_TEAMS } from '$lib/config';
import { createMockParty } from '../factories';

describe('teamTheme', () => {
	beforeEach(() => {
		cleanup();
	});

	it('uses the configured default teams before a party loads', () => {
		expect(get(teamTheme)).toEqual({
			rowName: DEFAULT_TEAMS.row.name,
			colName: DEFAULT_TEAMS.col.name,
			rowColor: DEFAULT_TEAMS.row.color,
			colColor: DEFAULT_TEAMS.col.color,
		});
	});

	it('follows the party, including edits made after it loaded', () => {
		party.set(createMockParty({ team_row_name: 'Eagles', team_row_color: '#004C54' }));
		expect(get(teamTheme)).toMatchObject({ rowName: 'Eagles', rowColor: '#004C54' });

		party.update((p) => (p ? { ...p, team_row_name: 'Ravens', team_row_color: '#241773' } : p));
		expect(get(teamTheme)).toMatchObject({ rowName: 'Ravens', rowColor: '#241773' });
	});

	it('goes back to the defaults when leaving the party', () => {
		party.set(createMockParty({ team_row_name: 'Eagles' }));
		cleanup();
		expect(get(teamTheme).rowName).toBe(DEFAULT_TEAMS.row.name);
	});
});
