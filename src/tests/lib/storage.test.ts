import { describe, it, expect, beforeEach } from 'vitest';
import { durable, jsonCodec, local, session } from '$lib/storage';
import { localStorageMock } from '../setup';
import { useFakeIdb } from './idbFake';

describe('durable', () => {
	let idb: ReturnType<typeof useFakeIdb>;
	beforeEach(() => {
		idb = useFakeIdb();
	});

	const value = () => durable<{ n: number }>('k', jsonCodec());

	it('keeps a value in IndexedDB', async () => {
		expect(await value().set({ n: 1 })).toBe(true);
		expect(await value().get()).toEqual({ n: 1 });
		expect(idb.data.get('k')).toEqual({ n: 1 });
	});

	it('falls back to localStorage when IndexedDB fails, and reads it back', async () => {
		idb.state.failing = true;
		expect(await value().set({ n: 2 })).toBe(true);
		expect(localStorageMock.getItem('k')).toBe('{"n":2}');
		expect(await value().get()).toEqual({ n: 2 });
	});

	it('removes from either place', async () => {
		await value().set({ n: 3 });
		await value().remove();
		expect(await value().get()).toBeNull();

		idb.state.failing = true;
		await value().set({ n: 4 });
		await value().remove();
		expect(await value().get()).toBeNull();
	});

	it('reads an unparseable fallback as missing', async () => {
		idb.state.failing = true;
		localStorageMock.setItem('k', '{not json');
		expect(await value().get()).toBeNull();
	});
});

describe('web storage', () => {
	it('reads and writes local and session storage', () => {
		expect(local.set('a', '1')).toBe(true);
		expect(local.get('a')).toBe('1');
		expect(session.set('b', '2')).toBe(true);
		expect(session.get('b')).toBe('2');
		session.remove('b');
		expect(session.get('b')).toBeNull();
	});
});
