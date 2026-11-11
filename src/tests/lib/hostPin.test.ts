import { describe, it, expect, beforeEach } from 'vitest';
import { forgetHostPin, recallHostPin, rememberHostPin } from '$lib/hostPin';
import { localStorageMock, sessionStorageMock } from '../setup';
import { useFakeIdb } from './idbFake';

describe('host PIN memory', () => {
	let idb: ReturnType<typeof useFakeIdb>;
	beforeEach(() => {
		idb = useFakeIdb();
	});

	it('remembers a PIN per party, across a new tab', async () => {
		await rememberHostPin('ABC123', '1234');
		await rememberHostPin('XYZ789', '9876');
		sessionStorageMock.clear();

		expect(await recallHostPin('ABC123')).toBe('1234');
		expect(await recallHostPin('XYZ789')).toBe('9876');
		expect(await recallHostPin('NOPE00')).toBeNull();
	});

	it('lasts only as long as the tab when IndexedDB is unavailable', async () => {
		idb.state.failing = true;
		await rememberHostPin('ABC123', '1234');
		expect(await recallHostPin('ABC123')).toBe('1234');
		expect(localStorageMock.getItem('squares_host_pins')).toBeNull();

		sessionStorageMock.clear();
		expect(await recallHostPin('ABC123')).toBeNull();
	});

	it('forgets a PIN everywhere and keeps the others', async () => {
		await rememberHostPin('ABC123', '1234');
		await rememberHostPin('XYZ789', '9876');

		await forgetHostPin('ABC123');

		expect(await recallHostPin('ABC123')).toBeNull();
		expect(sessionStorageMock.getItem('squares_pin_ABC123')).toBeNull();
		expect(await recallHostPin('XYZ789')).toBe('9876');
	});

	it('keeps the storage keys browsers already hold', async () => {
		await rememberHostPin('ABC123', '1234');
		expect(idb.data.get('squares_host_pins')).toEqual({ ABC123: '1234' });
		expect(sessionStorageMock.getItem('squares_pin_ABC123')).toBe('1234');
	});
});
