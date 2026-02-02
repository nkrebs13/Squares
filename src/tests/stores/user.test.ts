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
