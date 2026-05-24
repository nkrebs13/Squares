import { describe, expect, it } from 'vitest';
import { isCompletePartyCode, normalizePartyCode, PARTY_CODE_LENGTH } from '$lib/utils/partyCode';

describe('party code utils', () => {
	it('normalizes pasted codes to six uppercase alphanumeric characters', () => {
		expect(normalizePartyCode(' demo-01 ')).toBe('DEMO01');
		expect(normalizePartyCode('ab cd 12')).toBe('ABCD12');
		expect(normalizePartyCode('abc123-extra')).toBe('ABC123');
	});

	it('checks complete party codes after normalization', () => {
		expect(PARTY_CODE_LENGTH).toBe(6);
		expect(isCompletePartyCode('demo-01')).toBe(true);
		expect(isCompletePartyCode('abcd')).toBe(false);
	});
});
