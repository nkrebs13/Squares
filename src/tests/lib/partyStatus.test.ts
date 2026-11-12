import { describe, it, expect } from 'vitest';
import {
	getStatusBadge,
	hasDrawnNumbers,
	isFilling,
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
		expect(ALL.filter(hasDrawnNumbers)).toEqual(['locked', 'active', 'complete']);
		expect(ALL.map(statusLabel)).toEqual(['filling', 'active', 'active', 'complete']);
	});

	it('treats a missing party as none of them', () => {
		expect(isFilling(undefined) || isGameInProgress(undefined) || hasDrawnNumbers(undefined)).toBe(
			false
		);
	});
});

describe('getStatusBadge', () => {
	it.each([
		['filling', 'Filling', 'badge-filling'],
		['locked', 'Locked', 'badge-locked'],
		['active', 'Live', 'badge-active'],
		['complete', 'Done', 'badge-complete'],
	] as const)('maps %s', (status, text, cls) => {
		expect(getStatusBadge(status)).toEqual({ text, class: cls });
	});

	it('passes unknown statuses through with no class', () => {
		expect(getStatusBadge('mystery' as never)).toEqual({ text: 'mystery', class: '' });
	});
});
