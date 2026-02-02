import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { writable } from 'svelte/store';

// vi.hoisted runs before vi.mock hoisting, so the variable is available
const { mockPage } = vi.hoisted(() => {
	// Manual writable implementation to avoid CJS/ESM inconsistency
	type Subscriber<T> = (value: T) => void;
	function createWritable<T>(initial: T) {
		let value = initial;
		const subs = new Set<Subscriber<T>>();
		return {
			set(v: T) {
				value = v;
				subs.forEach((s) => s(value));
			},
			subscribe(fn: Subscriber<T>) {
				fn(value);
				subs.add(fn);
				return () => subs.delete(fn);
			},
		};
	}
	return {
		mockPage: createWritable({
			url: new URL('http://localhost/party/ABC123'),
			params: {},
			route: { id: '/party/[code]' },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		}),
	};
});

vi.mock('$app/stores', () => ({
	page: mockPage,
	navigating: writable(null),
	updated: { subscribe: writable(false).subscribe, check: vi.fn() },
}));

import FloatingHomeButton from '$lib/components/FloatingHomeButton.svelte';

describe('FloatingHomeButton', () => {
	beforeEach(() => {
		mockPage.set({
			url: new URL('http://localhost/party/ABC123'),
			params: {},
			route: { id: '/party/[code]' },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		});
	});

	it('renders home link on non-home pages', () => {
		const { container } = render(FloatingHomeButton);
		const link = container.querySelector('a[href="/"]');
		expect(link).toBeTruthy();
	});

	it('has correct aria-label', () => {
		const { container } = render(FloatingHomeButton);
		const link = container.querySelector('a');
		expect(link?.getAttribute('aria-label')).toBe('Return to home');
	});

	it('renders SVG icon', () => {
		const { container } = render(FloatingHomeButton);
		expect(container.querySelector('svg')).toBeTruthy();
	});

	it('hides on home page', () => {
		mockPage.set({
			url: new URL('http://localhost/'),
			params: {},
			route: { id: '/' },
			status: 200,
			error: null,
			data: {},
			form: null,
			state: {},
		});

		const { container } = render(FloatingHomeButton);
		const link = container.querySelector('a');
		expect(link).toBeNull();
	});
});
