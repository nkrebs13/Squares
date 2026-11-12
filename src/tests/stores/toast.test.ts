import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { toast } from '$lib/stores/toast';

describe('toast store', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		for (const t of get(toast)) toast.remove(t.id);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('shows toasts in order with their type', () => {
		toast.success('one');
		toast.error('two');
		expect(get(toast).map((t) => [t.message, t.type])).toEqual([
			['one', 'success'],
			['two', 'error'],
		]);
	});

	it('removes a toast exactly when its duration ends', () => {
		toast.success('bye', 1000);
		vi.advanceTimersByTime(999);
		expect(get(toast)).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(get(toast)).toHaveLength(0);
	});

	it('keeps errors up for 6s and confirmations for 3s', () => {
		toast.error('Error occurred');
		toast.success('Saved');

		vi.advanceTimersByTime(3000);
		expect(get(toast).map((t) => t.type)).toEqual(['error']);

		vi.advanceTimersByTime(3000);
		expect(get(toast)).toHaveLength(0);
	});

	it('removes one toast by id and leaves the others', () => {
		const first = toast.success('first');
		const second = toast.success('second');
		toast.remove(first);
		expect(get(toast).map((t) => t.id)).toEqual([second]);
	});

	it('cancels the timer of a toast removed early', () => {
		const id = toast.success('early', 1000);
		toast.remove(id);
		expect(vi.getTimerCount()).toBe(0);
	});
});
