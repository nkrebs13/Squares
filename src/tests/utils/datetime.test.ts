import { describe, expect, it } from 'vitest';
import {
	datetimeLocalToIso,
	formatKickoff,
	getLocalTimeZoneLabel,
	toDatetimeLocalValue,
} from '$lib/utils/datetime';

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
		expect(formatKickoff(null)).toBeNull();
		expect(formatKickoff('not-a-date')).toBeNull();
	});

	it('formats kickoff timestamps with optional timezone context', () => {
		const localValue = '2027-02-14T15:30';
		const iso = datetimeLocalToIso(localValue);

		expect(formatKickoff(iso)).toMatch(/Feb|2\/14|14/);
		expect(formatKickoff(iso, { includeWeekday: true, includeTimeZone: true })).toMatch(
			/Feb|2\/14|14/
		);
	});

	it('returns a readable local timezone label', () => {
		expect(getLocalTimeZoneLabel()).toMatch(/\S/);
	});
});
