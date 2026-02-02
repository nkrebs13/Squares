import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import {
	getUserName,
	setUserName,
	clearUserName,
	getRecentParties,
	saveRecentParty,
	removeRecentParty,
	updatePartyNickname,
	getHostPin,
	setHostPin,
} from '$lib/storage';
import type { RecentParty } from '$lib/types';

const mockIdbGet = vi.mocked(idbGet);
const mockIdbSet = vi.mocked(idbSet);
const mockIdbDel = vi.mocked(idbDel);

function createRecentParty(overrides: Partial<RecentParty> = {}): RecentParty {
	return {
		code: 'ABC123',
		teamRowName: 'Eagles',
		teamColName: 'Chiefs',
		lastVisited: Date.now(),
		status: 'filling',
		isHost: false,
		...overrides,
	};
}

describe('getUserName', () => {
	it('returns value from IndexedDB', async () => {
		mockIdbGet.mockResolvedValueOnce('Alice');
		const result = await getUserName();
		expect(result).toBe('Alice');
		expect(mockIdbGet).toHaveBeenCalledWith('squares_user_name');
	});

	it('falls back to localStorage when IndexedDB throws', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		localStorage.setItem('squares_user_name', 'Bob');
		const result = await getUserName();
		expect(result).toBe('Bob');
	});

	it('returns null when no name stored', async () => {
		mockIdbGet.mockResolvedValueOnce(undefined);
		const result = await getUserName();
		expect(result).toBeNull();
	});
});

describe('setUserName', () => {
	it('saves to IndexedDB', async () => {
		await setUserName('Alice');
		expect(mockIdbSet).toHaveBeenCalledWith('squares_user_name', 'Alice');
	});

	it('trims whitespace before saving', async () => {
		await setUserName('  Alice  ');
		expect(mockIdbSet).toHaveBeenCalledWith('squares_user_name', 'Alice');
	});

	it('does not save empty string', async () => {
		await setUserName('   ');
		expect(mockIdbSet).not.toHaveBeenCalled();
	});
});

describe('clearUserName', () => {
	it('removes from IndexedDB', async () => {
		await clearUserName();
		expect(mockIdbDel).toHaveBeenCalledWith('squares_user_name');
	});
});

describe('getRecentParties', () => {
	it('returns array from IndexedDB', async () => {
		const parties = [createRecentParty()];
		mockIdbGet.mockResolvedValueOnce(parties);
		const result = await getRecentParties();
		expect(result).toHaveLength(1);
		expect(result[0].code).toBe('ABC123');
	});

	it('returns empty array when no data', async () => {
		mockIdbGet.mockResolvedValueOnce(undefined);
		const result = await getRecentParties();
		expect(result).toEqual([]);
	});

	it('filters out expired parties', async () => {
		const expired = createRecentParty({
			code: 'OLD123',
			lastVisited: Date.now() - 91 * 24 * 60 * 60 * 1000,
		});
		const fresh = createRecentParty({ code: 'NEW123' });
		mockIdbGet.mockResolvedValueOnce([expired, fresh]);
		const result = await getRecentParties();
		expect(result).toHaveLength(1);
		expect(result[0].code).toBe('NEW123');
	});
});

describe('saveRecentParty', () => {
	it('adds party to beginning of list', async () => {
		const existing = createRecentParty({ code: 'EXIST1' });
		// First call from getRecentParties inside saveRecentParty
		mockIdbGet.mockResolvedValueOnce([existing]);
		const newParty = createRecentParty({ code: 'NEW123' });
		await saveRecentParty(newParty);

		expect(mockIdbSet).toHaveBeenCalledWith(
			'squares_recent_parties',
			expect.arrayContaining([expect.objectContaining({ code: 'NEW123' })])
		);
		// Verify the new party is first
		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].code).toBe('NEW123');
	});

	it('preserves existing nickname when updating', async () => {
		const existing = createRecentParty({ code: 'ABC123', nickname: 'My Game' });
		mockIdbGet.mockResolvedValueOnce([existing]);
		const updated = createRecentParty({ code: 'ABC123' }); // no nickname
		await saveRecentParty(updated);

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBe('My Game');
	});

	it('limits to MAX_RECENT_PARTIES (10)', async () => {
		const parties = Array.from({ length: 10 }, (_, i) =>
			createRecentParty({ code: `CODE${String(i).padStart(3, '0')}` })
		);
		mockIdbGet.mockResolvedValueOnce(parties);
		const newParty = createRecentParty({ code: 'NEW123' });
		await saveRecentParty(newParty);

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList).toHaveLength(10);
		expect(savedList[0].code).toBe('NEW123');
	});
});

describe('removeRecentParty', () => {
	it('filters out party by code', async () => {
		const parties = [createRecentParty({ code: 'ABC123' }), createRecentParty({ code: 'DEF456' })];
		mockIdbGet.mockResolvedValueOnce(parties);
		await removeRecentParty('ABC123');

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList).toHaveLength(1);
		expect(savedList[0].code).toBe('DEF456');
	});
});

describe('updatePartyNickname', () => {
	it('updates nickname for matching code', async () => {
		const parties = [createRecentParty({ code: 'ABC123' })];
		mockIdbGet.mockResolvedValueOnce(parties);
		await updatePartyNickname('ABC123', 'Super Bowl Party');

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBe('Super Bowl Party');
	});

	it('sets nickname to undefined for empty string', async () => {
		const parties = [createRecentParty({ code: 'ABC123', nickname: 'Old Name' })];
		mockIdbGet.mockResolvedValueOnce(parties);
		await updatePartyNickname('ABC123', '');

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBeUndefined();
	});
});

describe('getHostPin', () => {
	it('returns pin from IndexedDB', async () => {
		mockIdbGet.mockResolvedValueOnce({ ABC123: '1234' });
		const result = await getHostPin('ABC123');
		expect(result).toBe('1234');
	});

	it('returns null when no pin stored', async () => {
		mockIdbGet.mockResolvedValueOnce({});
		const result = await getHostPin('ABC123');
		expect(result).toBeNull();
	});

	it('falls back to sessionStorage when IndexedDB throws', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		sessionStorage.setItem('squares_pin_ABC123', '5678');
		const result = await getHostPin('ABC123');
		expect(result).toBe('5678');
	});
});

describe('setHostPin', () => {
	it('saves pin to IndexedDB', async () => {
		mockIdbGet.mockResolvedValueOnce({});
		await setHostPin('ABC123', '1234');
		expect(mockIdbSet).toHaveBeenCalledWith(
			'squares_host_pins',
			expect.objectContaining({ ABC123: '1234' })
		);
	});
});
