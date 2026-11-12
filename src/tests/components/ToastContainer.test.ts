import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import ToastContainer from '$lib/components/ToastContainer.svelte';
import { toast } from '$lib/stores/toast';

describe('ToastContainer', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		for (const t of get(toast)) toast.remove(t.id);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('stacks every shown toast in one container', async () => {
		render(ToastContainer);
		toast.success('First');
		toast.error('Second');
		await tick();

		const toasts = document.querySelectorAll('.toast-container > .toast');
		expect([...toasts].map((t) => t.textContent?.trim())).toEqual(['First', 'Second']);
	});

	it('announces errors assertively and other toasts politely', async () => {
		render(ToastContainer);
		toast.error('Broke');
		toast.success('Saved');
		await tick();

		expect(screen.getByRole('alert')).toHaveTextContent('Broke');
		expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
		expect(screen.getByRole('status')).toHaveTextContent('Saved');
		expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
	});

	it('takes a toast off the page when the store removes it', async () => {
		render(ToastContainer);
		toast.success('Temporary', 1000);
		await tick();
		expect(screen.getByText('Temporary')).toBeInTheDocument();

		await vi.advanceTimersByTimeAsync(1000);
		await vi.runAllTimersAsync();
		expect(screen.queryByText('Temporary')).not.toBeInTheDocument();
	});
});
