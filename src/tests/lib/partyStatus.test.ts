import { describe, it, expect } from 'vitest';
import {
	canActOnGrid,
	getStatusBadge,
	hasDrawnNumbers,
	isComplete,
	isFilling,
	isBehind,
	isStaleImage,
	isGameInProgress,
	PARTY_STATUSES,
	statusLabel,
} from '$lib/partyStatus';
import type { PartyStatus } from '$lib/types';

const ALL: readonly PartyStatus[] = PARTY_STATUSES;

describe('party status', () => {
	it('classifies every status', () => {
		expect(ALL.filter(isFilling)).toEqual(['filling']);
		expect(ALL.filter(isGameInProgress)).toEqual(['locked', 'active']);
		expect(ALL.filter(isComplete)).toEqual(['complete']);
		expect(ALL.filter(hasDrawnNumbers)).toEqual(['locked', 'active', 'complete']);
		expect(ALL.map(statusLabel)).toEqual(['filling', 'active', 'active', 'complete']);
	});

	it('treats a missing party as none of them', () => {
		expect(
			isFilling(undefined) ||
				isGameInProgress(undefined) ||
				hasDrawnNumbers(undefined) ||
				isComplete(undefined)
		).toBe(false);
	});
});

describe('getStatusBadge', () => {
	it.each([
		['filling', 'Filling', 'filling'],
		['locked', 'Locked', 'locked'],
		['active', 'Live', 'live'],
		['complete', 'Done', 'done'],
	] as const)('maps %s', (status, text, tone) => {
		expect(getStatusBadge(status)).toEqual({ text, tone });
	});
});

describe('canActOnGrid', () => {
	it('needs a user name and a filling party', () => {
		expect(canActOnGrid('filling', 'Ann')).toBe(true);
		expect(canActOnGrid('filling', '')).toBe(false);
		expect(canActOnGrid('filling', null)).toBe(false);
		expect(canActOnGrid(undefined, 'Ann')).toBe(false);
		for (const status of ['locked', 'active', 'complete'] as const) {
			expect(canActOnGrid(status, 'Ann')).toBe(false);
		}
	});
});

describe('isBehind', () => {
	it.each([
		['filling', 'active', true],
		['filling', 'locked', true],
		['active', 'complete', true],
		['active', 'locked', false],
		['active', 'filling', false],
		['complete', 'active', false],
		['filling', 'filling', false],
		['filling', undefined, false],
	] as const)('%s behind %s: %s', (next, current, expected) => {
		expect(isBehind(next, current)).toBe(expected);
	});
});

describe('isStaleImage', () => {
	it('only compares a party with itself', () => {
		const shown = { id: 'a', status: 'active' as const };
		expect(isStaleImage({ id: 'a', status: 'filling' }, shown)).toBe(true);
		expect(isStaleImage({ id: 'b', status: 'filling' }, shown)).toBe(false);
		expect(isStaleImage({ id: 'a', status: 'complete' }, shown)).toBe(false);
		expect(isStaleImage({ id: 'a', status: 'filling' }, null)).toBe(false);
	});
});
