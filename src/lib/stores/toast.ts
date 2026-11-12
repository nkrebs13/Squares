import { writable } from 'svelte/store';

export interface Toast {
	id: string;
	message: string;
	type: 'success' | 'error';
}

/** Errors stay up longer than confirmations so they can be read and acted on. */
const DEFAULT_TOAST_DURATION_MS = 3000;
const ERROR_TOAST_DURATION_MS = 6000;

/** The store owns each toast's whole life; the container only animates entries in and out. */
function createToastStore() {
	const { subscribe, update } = writable<Toast[]>([]);
	const timers = new Map<string, ReturnType<typeof setTimeout>>();
	let idCounter = 0;

	function show(message: string, type: Toast['type'], duration = DEFAULT_TOAST_DURATION_MS) {
		const id = `toast-${++idCounter}`;
		update((toasts) => [...toasts, { id, message, type }]);
		timers.set(
			id,
			setTimeout(() => remove(id), duration)
		);
		return id;
	}

	function remove(id: string) {
		clearTimeout(timers.get(id));
		timers.delete(id);
		update((toasts) => toasts.filter((t) => t.id !== id));
	}

	return {
		subscribe,
		success: (message: string, duration?: number) => show(message, 'success', duration),
		error: (message: string, duration = ERROR_TOAST_DURATION_MS) =>
			show(message, 'error', duration),
		/** Ends a toast early (and is how tests start from an empty stack). */
		remove,
	};
}

export const toast = createToastStore();
