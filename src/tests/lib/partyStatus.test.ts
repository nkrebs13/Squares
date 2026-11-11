import { describe, it, expect } from 'vitest';
import { hasDrawnNumbers, isFilling, isGameInProgress, statusLabel } from '$lib/partyStatus';
import type { PartyStatus } from '$lib/types';

const ALL: PartyStatus[] = ['filling', 'locked', 'active', 'complete'];

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
