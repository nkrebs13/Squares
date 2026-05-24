import { describe, expect, it } from 'vitest';
import { areDistinctTeamNames, normalizeTeamNameForMatchup } from '$lib/utils/teamNames';

describe('teamNames utilities', () => {
	it('normalizes case and repeated whitespace for matchup comparison', () => {
		expect(normalizeTeamNameForMatchup('  San   Francisco  ')).toBe('san francisco');
	});

	it('requires two non-empty distinct team names', () => {
		expect(areDistinctTeamNames('Ravens', 'Lions')).toBe(true);
		expect(areDistinctTeamNames(' Ravens ', 'ravens')).toBe(false);
		expect(areDistinctTeamNames('New   York', 'new york')).toBe(false);
		expect(areDistinctTeamNames('', 'Lions')).toBe(false);
	});
});
