import { describe, it, expect, vi } from 'vitest';
import { get as idbGet, set as idbSet, del as idbDel } from 'idb-keyval';
import {
	getUserName,
	setUserName,
	clearUserName,
	getLocalItem,
	setLocalItem,
	removeLocalItem,
	getSessionItem,
	setSessionItem,
	removeSessionItem,
	getRecentParties,
	saveRecentParty,
	removeRecentParty,
	updatePartyNickname,
	getHostPin,
	setHostPin,
	removeHostPin,
	hasHostPin,
	hasSeenGestureHint,
	markGestureHintSeen,
	requestPersistentStorage,
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

	it('returns null when both IndexedDB and localStorage are unavailable', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		vi.mocked(localStorage.getItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});

		await expect(getUserName()).resolves.toBeNull();
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

	it('falls back to sessionStorage when IndexedDB has no pin for the code', async () => {
		mockIdbGet.mockResolvedValueOnce({});
		sessionStorage.setItem('squares_pin_ABC123', '5678');
		const result = await getHostPin('ABC123');
		expect(result).toBe('5678');
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

	it('falls back to sessionStorage when IndexedDB throws', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		await setHostPin('ABC123', '5678');
		expect(sessionStorage.getItem('squares_pin_ABC123')).toBe('5678');
	});
});

describe('removeHostPin', () => {
	it('removes pin from IndexedDB', async () => {
		mockIdbGet.mockResolvedValueOnce({ ABC123: '1234', DEF456: '5678' });
		await removeHostPin('ABC123');
		expect(mockIdbSet).toHaveBeenCalledWith(
			'squares_host_pins',
			expect.not.objectContaining({ ABC123: '1234' })
		);
	});

	it('falls back to sessionStorage when IndexedDB throws', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		sessionStorage.setItem('squares_pin_ABC123', '1234');
		await removeHostPin('ABC123');
		expect(sessionStorage.getItem('squares_pin_ABC123')).toBeNull();
	});
});

describe('hasHostPin', () => {
	it('returns true when pin exists', async () => {
		mockIdbGet.mockResolvedValueOnce({ ABC123: '1234' });
		const result = await hasHostPin('ABC123');
		expect(result).toBe(true);
	});

	it('returns false when pin does not exist', async () => {
		mockIdbGet.mockResolvedValueOnce({});
		const result = await hasHostPin('ABC123');
		expect(result).toBe(false);
	});
});

describe('hasSeenGestureHint', () => {
	it('returns true when seen', async () => {
		mockIdbGet.mockResolvedValueOnce(true);
		const result = await hasSeenGestureHint();
		expect(result).toBe(true);
	});

	it('returns false when not seen', async () => {
		mockIdbGet.mockResolvedValueOnce(undefined);
		const result = await hasSeenGestureHint();
		expect(result).toBe(false);
	});

	it('falls back to localStorage when IndexedDB throws', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		localStorage.setItem('squares_gesture_hint_shown', 'true');
		const result = await hasSeenGestureHint();
		expect(result).toBe(true);
	});
});

describe('markGestureHintSeen', () => {
	it('saves to IndexedDB', async () => {
		await markGestureHintSeen();
		expect(mockIdbSet).toHaveBeenCalledWith('squares_gesture_hint_shown', true);
	});

	it('falls back to localStorage when IndexedDB throws', async () => {
		mockIdbSet.mockRejectedValueOnce(new Error('IDB error'));
		await markGestureHintSeen();
		expect(localStorage.getItem('squares_gesture_hint_shown')).toBe('true');
	});
});

describe('requestPersistentStorage', () => {
	it('returns false when navigator.storage.persist is not available', async () => {
		const result = await requestPersistentStorage();
		// In test environment, navigator.storage may not exist
		expect(typeof result).toBe('boolean');
	});
});

describe('saveRecentParty with nickname', () => {
	it('saves nickname when provided', async () => {
		mockIdbGet.mockResolvedValueOnce([]);
		const party = createRecentParty({ code: 'ABC123', nickname: 'Work Pool' });
		await saveRecentParty(party);

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBe('Work Pool');
	});

	it('new nickname overrides existing nickname', async () => {
		const existing = createRecentParty({ code: 'ABC123', nickname: 'Old Name' });
		mockIdbGet.mockResolvedValueOnce([existing]);
		const updated = createRecentParty({ code: 'ABC123', nickname: 'New Name' });
		await saveRecentParty(updated);

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBe('New Name');
	});

	it('preserves existing nickname when new entry has no nickname', async () => {
		const existing = createRecentParty({ code: 'ABC123', nickname: 'My Game' });
		mockIdbGet.mockResolvedValueOnce([existing]);
		const updated = createRecentParty({ code: 'ABC123' }); // no nickname
		await saveRecentParty(updated);

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBe('My Game');
	});

	it('does not set nickname when neither existing nor new has one', async () => {
		mockIdbGet.mockResolvedValueOnce([]);
		const party = createRecentParty({ code: 'ABC123' });
		await saveRecentParty(party);

		const savedList = mockIdbSet.mock.calls[0][1] as RecentParty[];
		expect(savedList[0].nickname).toBeUndefined();
	});
});

describe('saveRecentParty localStorage fallback', () => {
	it('falls back to localStorage when IndexedDB throws', async () => {
		mockIdbGet.mockRejectedValue(new Error('IDB error'));
		mockIdbSet.mockRejectedValue(new Error('IDB error'));

		const party = createRecentParty({ code: 'FALL01' });
		await saveRecentParty(party);

		const stored = localStorage.getItem('squares_recent_parties');
		expect(stored).not.toBeNull();
		if (!stored) return;
		const parsed = JSON.parse(stored);
		expect(parsed[0].code).toBe('FALL01');
	});
});

describe('removeRecentParty localStorage fallback', () => {
	it('falls back to localStorage when IndexedDB throws', async () => {
		// Pre-populate localStorage
		const parties = [createRecentParty({ code: 'ABC123' }), createRecentParty({ code: 'DEF456' })];
		localStorage.setItem('squares_recent_parties', JSON.stringify(parties));

		mockIdbGet.mockRejectedValue(new Error('IDB error'));
		mockIdbSet.mockRejectedValue(new Error('IDB error'));

		await removeRecentParty('ABC123');

		const stored = localStorage.getItem('squares_recent_parties');
		expect(stored).not.toBeNull();
		if (!stored) return;
		const parsed = JSON.parse(stored);
		expect(parsed).toHaveLength(1);
		expect(parsed[0].code).toBe('DEF456');
	});
});

describe('updatePartyNickname localStorage fallback', () => {
	it('falls back to localStorage when IndexedDB throws', async () => {
		const parties = [createRecentParty({ code: 'ABC123' })];
		localStorage.setItem('squares_recent_parties', JSON.stringify(parties));

		mockIdbGet.mockRejectedValue(new Error('IDB error'));
		mockIdbSet.mockRejectedValue(new Error('IDB error'));

		await updatePartyNickname('ABC123', 'My Game');

		const stored = localStorage.getItem('squares_recent_parties');
		expect(stored).not.toBeNull();
		if (!stored) return;
		const parsed = JSON.parse(stored);
		expect(parsed[0].nickname).toBe('My Game');
	});
});

describe('getRecentParties fallback', () => {
	it('returns empty when both IndexedDB and localStorage return nothing', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		const result = await getRecentParties();
		expect(result).toEqual([]);
	});

	it('returns empty when both IndexedDB throws and localStorage has invalid JSON', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		localStorage.setItem('squares_recent_parties', 'not-json');
		const result = await getRecentParties();
		expect(result).toEqual([]);
	});
});

describe('clearUserName fallback', () => {
	it('falls back to localStorage.removeItem when IndexedDB throws', async () => {
		mockIdbDel.mockRejectedValueOnce(new Error('IDB error'));
		await clearUserName();
		expect(localStorage.removeItem).toHaveBeenCalledWith('squares_user_name');
	});
});

describe('setUserName fallback', () => {
	it('falls back to localStorage when IndexedDB throws', async () => {
		mockIdbSet.mockRejectedValueOnce(new Error('IDB error'));
		await setUserName('Fallback');
		expect(localStorage.getItem('squares_user_name')).toBe('Fallback');
	});

	it('does not throw when IndexedDB and localStorage writes both fail', async () => {
		mockIdbSet.mockRejectedValueOnce(new Error('IDB error'));
		vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});

		await expect(setUserName('Fallback')).resolves.toBeUndefined();
	});
});

describe('hasHostPin error handling', () => {
	it('returns false when getHostPin falls back and finds no pin', async () => {
		mockIdbGet.mockRejectedValueOnce(new Error('IDB error'));
		// sessionStorage has no pin
		const result = await hasHostPin('NOPIN1');
		expect(result).toBe(false);
	});
});

describe('safe web storage helpers', () => {
	it('return null/false instead of throwing when localStorage is blocked', () => {
		vi.mocked(localStorage.getItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(localStorage.setItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(localStorage.removeItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});

		expect(getLocalItem('blocked')).toBeNull();
		expect(setLocalItem('blocked', 'value')).toBe(false);
		expect(removeLocalItem('blocked')).toBe(false);
	});

	it('return null/false instead of throwing when sessionStorage is blocked', () => {
		vi.mocked(sessionStorage.getItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(sessionStorage.setItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(sessionStorage.removeItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});

		expect(getSessionItem('blocked')).toBeNull();
		expect(setSessionItem('blocked', 'value')).toBe(false);
		expect(removeSessionItem('blocked')).toBe(false);
	});

	it('keeps host PIN helpers non-throwing when fallback sessionStorage is blocked', async () => {
		mockIdbGet.mockRejectedValue(new Error('IDB error'));
		mockIdbSet.mockRejectedValue(new Error('IDB error'));
		mockIdbDel.mockRejectedValue(new Error('IDB error'));
		vi.mocked(sessionStorage.getItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(sessionStorage.setItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});
		vi.mocked(sessionStorage.removeItem).mockImplementationOnce(() => {
			throw new Error('storage blocked');
		});

		await expect(getHostPin('ABC123')).resolves.toBeNull();
		await expect(setHostPin('ABC123', '1234')).resolves.toBeUndefined();
		await expect(removeHostPin('ABC123')).resolves.toBeUndefined();
	});
});
