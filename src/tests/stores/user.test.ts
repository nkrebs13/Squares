import { describe, it, expect, beforeEach, vi } from 'vitest';
import { get } from 'svelte/store';
import { set as idbSet, del as idbDel } from 'idb-keyval';

const mockIdbSet = vi.mocked(idbSet);
const mockIdbDel = vi.mocked(idbDel);

// We need to re-import fresh modules per test to reset store state
let userName: typeof import('$lib/stores/user').userName;
let normalizePlayerName: typeof import('$lib/stores/user').normalizePlayerName;

describe('userName store', () => {
	beforeEach(async () => {
		vi.resetModules();
		vi.clearAllMocks();
		// Re-import to get a fresh store instance
		const mod = await import('$lib/stores/user');
		userName = mod.userName;
		normalizePlayerName = mod.normalizePlayerName;
	});

	it('initializes from localStorage', async () => {
		localStorage.setItem('squares_user_name', 'TestUser');
		vi.resetModules();
		const mod = await import('$lib/stores/user');
		expect(get(mod.userName)).toBe('TestUser');
	});

	it('initializes as null when localStorage is empty', () => {
		expect(get(userName)).toBeNull();
	});

	it('setName sets store value', async () => {
		await userName.setName('Alice');
		expect(get(userName)).toBe('Alice');
	});

	it('setName persists to localStorage', async () => {
		await userName.setName('Alice');
		expect(localStorage.setItem).toHaveBeenCalledWith('squares_user_name', 'Alice');
	});

	it('setName persists to IndexedDB via idb-keyval', async () => {
		await userName.setName('Alice');
		// The user store calls setUserName('Alice') which calls idb-keyval set()
		expect(mockIdbSet).toHaveBeenCalledWith('squares_user_name', 'Alice');
	});

	it('setName trims whitespace', async () => {
		await userName.setName('  Alice  ');
		expect(get(userName)).toBe('Alice');
	});

	it('setName sets null for empty string', async () => {
		await userName.setName('Alice');
		await userName.setName('');
		expect(get(userName)).toBeNull();
	});

	it('clear removes from store and storage', async () => {
		await userName.setName('Alice');
		await userName.clear();
		expect(get(userName)).toBeNull();
		expect(localStorage.removeItem).toHaveBeenCalledWith('squares_user_name');
		expect(mockIdbDel).toHaveBeenCalledWith('squares_user_name');
	});
});

describe('userName async IndexedDB initialization', () => {
	it('overwrites store with IndexedDB value when available', async () => {
		// Start with a localStorage value
		localStorage.setItem('squares_user_name', 'FromLocal');
		vi.resetModules();

		// Mock getUserName to return a value from IndexedDB
		const idbGetMock = vi.mocked((await import('idb-keyval')).get);
		idbGetMock.mockResolvedValueOnce('FromIndexedDB');

		const mod = await import('$lib/stores/user');
		// Wait for the async initialization to complete
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Store should be updated with IndexedDB value
		expect(get(mod.userName)).toBe('FromIndexedDB');
		// localStorage should be synced as fallback
		expect(localStorage.getItem('squares_user_name')).toBe('FromIndexedDB');
	});

	it('does not overwrite store when IndexedDB returns null', async () => {
		// Set localStorage value, but IndexedDB returns nothing
		localStorage.setItem('squares_user_name', 'FromLocal');
		vi.resetModules();

		// Mock getUserName to return null
		const idbGetMock = vi.mocked((await import('idb-keyval')).get);
		idbGetMock.mockResolvedValueOnce(undefined);

		const mod = await import('$lib/stores/user');
		// Wait for the async initialization to complete
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Store should still have the localStorage value since IndexedDB had nothing
		expect(get(mod.userName)).toBe('FromLocal');
	});

	it('setName works when setUserName throws (IndexedDB error)', async () => {
		const idbSetMock = vi.mocked((await import('idb-keyval')).set);
		idbSetMock.mockRejectedValueOnce(new Error('IDB write failed'));

		// setUserName in storage.ts catches the error and falls back to localStorage
		await userName.setName('Charlie');

		// Store should still be updated (set() is called before await)
		expect(get(userName)).toBe('Charlie');
		expect(localStorage.getItem('squares_user_name')).toBe('Charlie');
	});

	it('clear works when clearUserName throws (IndexedDB error)', async () => {
		const idbDelMock = vi.mocked((await import('idb-keyval')).del);
		idbDelMock.mockRejectedValueOnce(new Error('IDB delete failed'));

		await userName.setName('Dave');

		// clearUserName in storage.ts catches the error and falls back to localStorage
		await userName.clear();

		expect(get(userName)).toBeNull();
		expect(localStorage.removeItem).toHaveBeenCalledWith('squares_user_name');
	});
});

describe('normalizePlayerName', () => {
	beforeEach(async () => {
		vi.resetModules();
		const mod = await import('$lib/stores/user');
		normalizePlayerName = mod.normalizePlayerName;
	});

	it('lowercases the name', () => {
		expect(normalizePlayerName('John Doe')).toBe('john doe');
	});

	it('trims whitespace', () => {
		expect(normalizePlayerName('  Alice  ')).toBe('alice');
	});
});
