import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/svelte';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import ToastContainer from '$lib/components/ToastContainer.svelte';
import { toast } from '$lib/stores/toast';

describe('ToastContainer Component', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		// Clear any leftover toasts from previous tests
		const toasts = get(toast);
		for (const t of toasts) {
			toast.remove(t.id);
		}
	});

	it('renders nothing when no toasts exist', () => {
		render(ToastContainer);
		expect(document.querySelector('.toast-container')).not.toBeInTheDocument();
	});

	it('renders container when toast is shown', async () => {
		render(ToastContainer);
		toast.show('Test message');
		await tick();

		expect(document.querySelector('.toast-container')).toBeInTheDocument();
	});

	it('renders toast message content', async () => {
		render(ToastContainer);
		toast.show('Hello from toast');
		await tick();

		const msg = document.querySelector('.toast-message');
		expect(msg?.textContent).toBe('Hello from toast');
	});

	it('renders multiple toasts', async () => {
		render(ToastContainer);
		toast.show('First toast');
		toast.show('Second toast');
		await tick();

		const messages = document.querySelectorAll('.toast-message');
		expect(messages).toHaveLength(2);
		expect(messages[0].textContent).toBe('First toast');
		expect(messages[1].textContent).toBe('Second toast');
	});

	it('removes toast from store when removed', async () => {
		render(ToastContainer);
		const id = toast.show('Temporary', 'info', 1000);
		await tick();

		expect(get(toast)).toHaveLength(1);

		toast.remove(id);
		await tick();

		expect(get(toast)).toHaveLength(0);
	});
});
