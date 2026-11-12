import { describe, it, expect } from 'vitest';
import { MAX_EVENT_NAME_LENGTH } from '$lib/constants';
import {
	formatKickoffPreview,
	isValidEventName,
	isValidHostName,
	isValidMatchup,
	isValidPin,
} from '$lib/utils/partyForm';

describe('isValidPin', () => {
	it('accepts exactly four digits', () => {
		expect(isValidPin('0123')).toBe(true);
	});

	it('rejects wrong length or non-digits', () => {
		expect(isValidPin('123')).toBe(false);
		expect(isValidPin('12345')).toBe(false);
		expect(isValidPin('12a4')).toBe(false);
		expect(isValidPin('')).toBe(false);
	});
});

describe('isValidHostName', () => {
	it('requires a non-blank name', () => {
		expect(isValidHostName('Nathan')).toBe(true);
		expect(isValidHostName('   ')).toBe(false);
		expect(isValidHostName('')).toBe(false);
	});
});

describe('isValidEventName', () => {
	it('requires 1 to MAX_EVENT_NAME_LENGTH trimmed characters', () => {
		expect(isValidEventName('Super Bowl')).toBe(true);
		expect(isValidEventName('  ')).toBe(false);
		expect(isValidEventName('a'.repeat(MAX_EVENT_NAME_LENGTH))).toBe(true);
		expect(isValidEventName('a'.repeat(MAX_EVENT_NAME_LENGTH + 1))).toBe(false);
	});
});

describe('isValidMatchup', () => {
	it('requires two named, distinct teams', () => {
		expect(isValidMatchup('Eagles', 'Chiefs')).toBe(true);
		expect(isValidMatchup('Eagles', ' eagles ')).toBe(false);
		expect(isValidMatchup('', 'Chiefs')).toBe(false);
		expect(isValidMatchup('Eagles', '   ')).toBe(false);
	});
});

describe('formatKickoffPreview', () => {
	it('returns null for empty or invalid input', () => {
		expect(formatKickoffPreview('')).toBeNull();
		expect(formatKickoffPreview('not-a-date')).toBeNull();
	});

	it('returns a formatted line for a valid datetime-local value', () => {
		const preview = formatKickoffPreview('2027-02-14T18:30');
		expect(preview).toContain('Feb');
		expect(preview).toContain('14');
	});
});
