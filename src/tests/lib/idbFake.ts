import { vi } from 'vitest';
import * as idb from 'idb-keyval';

/**
 * Back the idb-keyval mock (setup.ts) with a Map. `failing` makes every call
 * reject; `failingWrites` only set/del (e.g. quota exceeded).
 */
export function useFakeIdb() {
	const data = new Map<string, unknown>();
	const state = { failing: false, failingWrites: false };
	const guard = <T>(fn: () => T) =>
		state.failing ? Promise.reject(new Error('IndexedDB unavailable')) : Promise.resolve(fn());
	vi.mocked(idb.get).mockImplementation((key) => guard(() => data.get(String(key))) as never);
	vi.mocked(idb.set).mockImplementation((key, value) =>
		guard(() => void data.set(String(key), value))
	);
	vi.mocked(idb.del).mockImplementation((key) => guard(() => void data.delete(String(key))));
	return { data, state };
}
