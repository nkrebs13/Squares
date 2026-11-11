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
		toast.info('one');
		toast.success('two');
		toast.error('three');
		expect(get(toast).map((t) => [t.message, t.type])).toEqual([
			['one', 'info'],
			['two', 'success'],
			['three', 'error'],
		]);
	});

	it('removes a toast exactly when its duration ends', () => {
		toast.show('bye', 'info', 1000);
		vi.advanceTimersByTime(999);
		expect(get(toast)).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(get(toast)).toHaveLength(0);
	});

	it('keeps errors up for 6s and everything else for 3s', () => {
		toast.error('Error occurred');
		toast.success('Saved');
		toast.info('FYI');

		vi.advanceTimersByTime(3000);
		expect(get(toast).map((t) => t.type)).toEqual(['error']);

		vi.advanceTimersByTime(3000);
		expect(get(toast)).toHaveLength(0);
	});

	it('removes one toast by id and leaves the others', () => {
		const first = toast.show('first');
		const second = toast.show('second');
		toast.remove(first);
		expect(get(toast).map((t) => t.id)).toEqual([second]);
	});

	it('cancels the timer of a toast removed early', () => {
		const id = toast.show('early', 'info', 1000);
		toast.remove(id);
		expect(vi.getTimerCount()).toBe(0);
	});
});
