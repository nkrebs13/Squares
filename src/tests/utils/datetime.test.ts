import { describe, expect, it } from 'vitest';
import { datetimeLocalToIso, toDatetimeLocalValue } from '$lib/utils/datetime';

describe('datetime utils', () => {
	it('round-trips a datetime-local value through ISO', () => {
		const localValue = '2027-02-14T15:30';

		expect(toDatetimeLocalValue(datetimeLocalToIso(localValue))).toBe(localValue);
	});

	it('returns empty/null for missing or invalid values', () => {
		expect(toDatetimeLocalValue(null)).toBe('');
		expect(toDatetimeLocalValue('not-a-date')).toBe('');
		expect(datetimeLocalToIso('')).toBeNull();
		expect(datetimeLocalToIso('not-a-date')).toBeNull();
	});
});
