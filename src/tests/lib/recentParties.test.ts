import { describe, it, expect, beforeEach } from 'vitest';
import {
	getRecentParties,
	removeRecentParty,
	saveRecentParty,
	stageNickname,
	updatePartyNickname,
} from '$lib/recentParties';
import type { RecentParty } from '$lib/types';
import { localStorageMock } from '../setup';
import { useFakeIdb } from './idbFake';

function visit(code: string, overrides: Partial<RecentParty> = {}): RecentParty {
	return {
		code,
		eventName: 'Big Game',
		kickoffAt: null,
		teamRowName: 'Eagles',
		teamColName: 'Chiefs',
		lastVisited: Date.now(),
		status: 'filling',
		isHost: false,
		...overrides,
	};
}

const codes = async () => (await getRecentParties()).map((p) => p.code);

describe('recent parties', () => {
	let idb: ReturnType<typeof useFakeIdb>;
	beforeEach(() => {
		idb = useFakeIdb();
	});

	it('lists visits newest first, one entry per party, at most ten', async () => {
		for (let i = 0; i < 12; i++) await saveRecentParty(visit(`P${i}`));
		await saveRecentParty(visit('P5'));

		const list = await codes();
		expect(list[0]).toBe('P5');
		expect(list).toHaveLength(10);
		expect(new Set(list).size).toBe(10);
	});

	it('drops visits older than 90 days', async () => {
		await saveRecentParty(visit('OLD', { lastVisited: Date.now() - 91 * 24 * 3600 * 1000 }));
		await saveRecentParty(visit('NEW'));
		expect(await codes()).toEqual(['NEW']);
	});

	it('applies a nickname staged on the create/join page to the next visit, once', async () => {
		stageNickname('ABC123', '  Office Pool ');
		await saveRecentParty(visit('ABC123'));
		expect((await getRecentParties())[0].nickname).toBe('Office Pool');

		await saveRecentParty(visit('ABC123'));
		expect((await getRecentParties())[0].nickname).toBe('Office Pool');
	});

	it('renames and removes entries', async () => {
		await saveRecentParty(visit('ABC123'));
		await updatePartyNickname('ABC123', 'Family');
		expect((await getRecentParties())[0].nickname).toBe('Family');

		await removeRecentParty('ABC123');
		expect(await codes()).toEqual([]);
	});

	it('keeps the newest list in localStorage while IndexedDB writes fail', async () => {
		await saveRecentParty(visit('FIRST'));
		idb.state.failingWrites = true;
		await saveRecentParty(visit('SECOND'));
		idb.state.failingWrites = false;

		// IndexedDB still holds the stale list; the marker makes reads use localStorage.
		expect(await codes()).toEqual(['SECOND', 'FIRST']);

		await saveRecentParty(visit('THIRD'));
		expect(await codes()).toEqual(['THIRD', 'SECOND', 'FIRST']);
		expect(localStorageMock.getItem('squares_recent_parties_in_local')).toBeNull();
	});
});
