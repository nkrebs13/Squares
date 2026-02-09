import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestPersistentStorage } from '$lib/storage';

describe('requestPersistentStorage', () => {
	let originalStorage: StorageManager | undefined;

	beforeEach(() => {
		originalStorage = navigator.storage;
	});

	afterEach(() => {
		// Restore original
		Object.defineProperty(navigator, 'storage', {
			value: originalStorage,
			writable: true,
			configurable: true,
		});
	});

	it('returns false when navigator.storage.persist is not available', async () => {
		Object.defineProperty(navigator, 'storage', {
			value: {},
			writable: true,
			configurable: true,
		});
		const result = await requestPersistentStorage();
		expect(result).toBe(false);
	});

	it('returns true when already persisted', async () => {
		Object.defineProperty(navigator, 'storage', {
			value: {
				persist: vi.fn(),
				persisted: vi.fn().mockResolvedValue(true),
			},
			writable: true,
			configurable: true,
		});
		const result = await requestPersistentStorage();
		expect(result).toBe(true);
	});

	it('requests persistence when not yet persisted', async () => {
		const mockPersist = vi.fn().mockResolvedValue(true);
		Object.defineProperty(navigator, 'storage', {
			value: {
				persist: mockPersist,
				persisted: vi.fn().mockResolvedValue(false),
			},
			writable: true,
			configurable: true,
		});
		const result = await requestPersistentStorage();
		expect(result).toBe(true);
		expect(mockPersist).toHaveBeenCalled();
	});

	it('returns false when persistence request is denied', async () => {
		Object.defineProperty(navigator, 'storage', {
			value: {
				persist: vi.fn().mockResolvedValue(false),
				persisted: vi.fn().mockResolvedValue(false),
			},
			writable: true,
			configurable: true,
		});
		const result = await requestPersistentStorage();
		expect(result).toBe(false);
	});

	it('returns false when persisted() throws', async () => {
		Object.defineProperty(navigator, 'storage', {
			value: {
				persist: vi.fn(),
				persisted: vi.fn().mockRejectedValue(new Error('Permission denied')),
			},
			writable: true,
			configurable: true,
		});
		const result = await requestPersistentStorage();
		expect(result).toBe(false);
	});
});
