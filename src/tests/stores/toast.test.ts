import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { get } from 'svelte/store';
import { toast } from '$lib/stores/toast';

describe('Toast Store', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Clear all toasts by removing them manually
		const toasts = get(toast);
		toasts.forEach((t) => toast.remove(t.id));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	describe('show', () => {
		it('adds a toast to the store', () => {
			toast.show('Test message');

			const toasts = get(toast);
			expect(toasts).toHaveLength(1);
			expect(toasts[0].message).toBe('Test message');
		});

		it('defaults to info type', () => {
			toast.show('Test message');

			const toasts = get(toast);
			expect(toasts[0].type).toBe('info');
		});

		it('respects custom type', () => {
			toast.show('Error message', 'error');

			const toasts = get(toast);
			expect(toasts[0].type).toBe('error');
		});

		it('returns the toast id', () => {
			const id = toast.show('Test');

			expect(id).toMatch(/^toast-\d+$/);
		});

		it('auto-removes toast after duration + animation time', () => {
			toast.show('Test message', 'info', 1000);

			expect(get(toast)).toHaveLength(1);

			// Advance past duration + animation time (1000 + 300)
			vi.advanceTimersByTime(1300);

			expect(get(toast)).toHaveLength(0);
		});

		it('can add multiple toasts', () => {
			toast.show('Message 1');
			toast.show('Message 2');
			toast.show('Message 3');

			expect(get(toast)).toHaveLength(3);
		});

		it('assigns unique ids to each toast', () => {
			const id1 = toast.show('Message 1');
			const id2 = toast.show('Message 2');

			expect(id1).not.toBe(id2);
		});
	});

	describe('success', () => {
		it('creates a success toast', () => {
			toast.success('Success!');

			const toasts = get(toast);
			expect(toasts[0].type).toBe('success');
			expect(toasts[0].message).toBe('Success!');
		});

		it('respects custom duration', () => {
			toast.success('Success!', 5000);

			expect(get(toast)).toHaveLength(1);

			vi.advanceTimersByTime(3000);
			expect(get(toast)).toHaveLength(1);

			vi.advanceTimersByTime(2300);
			expect(get(toast)).toHaveLength(0);
		});
	});

	describe('error', () => {
		it('creates an error toast', () => {
			toast.error('Error occurred');

			const toasts = get(toast);
			expect(toasts[0].type).toBe('error');
			expect(toasts[0].message).toBe('Error occurred');
		});
	});

	describe('info', () => {
		it('creates an info toast', () => {
			toast.info('FYI');

			const toasts = get(toast);
			expect(toasts[0].type).toBe('info');
			expect(toasts[0].message).toBe('FYI');
		});
	});

	describe('remove', () => {
		it('removes a specific toast by id', () => {
			const id1 = toast.show('Message 1');
			const id2 = toast.show('Message 2');

			toast.remove(id1);

			const toasts = get(toast);
			expect(toasts).toHaveLength(1);
			expect(toasts[0].id).toBe(id2);
		});

		it('does nothing if id not found', () => {
			toast.show('Message');

			toast.remove('non-existent-id');

			expect(get(toast)).toHaveLength(1);
		});
	});

	describe('default duration', () => {
		it('uses 3000ms as default duration', () => {
			toast.show('Test');

			expect(get(toast)).toHaveLength(1);

			vi.advanceTimersByTime(3000);
			expect(get(toast)).toHaveLength(1); // Still there (animation buffer)

			vi.advanceTimersByTime(300);
			expect(get(toast)).toHaveLength(0);
		});
	});

	describe('toast data structure', () => {
		it('includes id, message, type, and duration', () => {
			toast.show('Test', 'success', 2000);

			const toasts = get(toast);
			expect(toasts[0]).toMatchObject({
				message: 'Test',
				type: 'success',
				duration: 2000,
			});
			expect(toasts[0].id).toBeDefined();
		});
	});
});
