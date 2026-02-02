import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { writable } from 'svelte/store';

// vi.hoisted runs before vi.mock hoisting, so the variable is available
const { mockPage } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { writable } = require('svelte/store');
	return {
		mockPage: writable({
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
	it('renders home link on non-home pages', () => {
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

		const { container } = render(FloatingHomeButton);
		const link = container.querySelector('a[href="/"]');
		expect(link).toBeTruthy();
	});

	it('has correct aria-label', () => {
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

		const { container } = render(FloatingHomeButton);
		const link = container.querySelector('a');
		expect(link?.getAttribute('aria-label')).toBe('Return to home');
	});

	it('renders SVG icon', () => {
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
