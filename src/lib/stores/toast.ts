import { writable } from 'svelte/store';

export interface Toast {
	id: string;
	message: string;
	type: 'success' | 'error' | 'info';
	duration?: number;
}

/** Errors stay up longer than confirmations so they can be read and acted on. */
export const DEFAULT_TOAST_DURATION_MS = 3000;
export const ERROR_TOAST_DURATION_MS = 6000;

function createToastStore() {
	const { subscribe, update } = writable<Toast[]>([]);

	let idCounter = 0;

	function show(
		message: string,
		type: Toast['type'] = 'info',
		duration = DEFAULT_TOAST_DURATION_MS
	) {
		const id = `toast-${++idCounter}`;
		const toast: Toast = { id, message, type, duration };

		update((toasts) => [...toasts, toast]);

		// Auto-remove after duration
		setTimeout(() => {
			remove(id);
		}, duration + 300); // Extra time for exit animation

		return id;
	}

	function remove(id: string) {
		update((toasts) => toasts.filter((t) => t.id !== id));
	}

	return {
		subscribe,
		show,
		success: (message: string, duration?: number) => show(message, 'success', duration),
		error: (message: string, duration = ERROR_TOAST_DURATION_MS) =>
			show(message, 'error', duration),
		info: (message: string, duration?: number) => show(message, 'info', duration),
		remove,
	};
}

export const toast = createToastStore();
