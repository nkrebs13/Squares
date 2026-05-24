import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/svelte';
import BoundaryFallback from '$lib/components/BoundaryFallback.svelte';

const reloadMock = vi.fn();

describe('BoundaryFallback', () => {
	beforeEach(() => {
		vi.stubGlobal('location', { ...window.location, reload: reloadMock });
		reloadMock.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('renders error message in card variant by default', () => {
		const { container, getByText } = render(BoundaryFallback, { props: { reset: vi.fn() } });
		expect(getByText('This section encountered an error.')).toBeTruthy();
		expect(container.querySelector('aside')).toBeNull();
	});

	it('renders inside aside element in aside variant', () => {
		const { container } = render(BoundaryFallback, {
			props: { reset: vi.fn(), variant: 'aside' },
		});
		expect(container.querySelector('aside')).toBeTruthy();
	});

	it('calls reset prop when Try again is clicked', async () => {
		const reset = vi.fn();
		const { getByText } = render(BoundaryFallback, { props: { reset } });
		await fireEvent.click(getByText('Try again'));
		expect(reset).toHaveBeenCalledOnce();
	});

	it('calls window.location.reload when Reload is clicked', async () => {
		const { getByText } = render(BoundaryFallback, { props: { reset: vi.fn() } });
		await fireEvent.click(getByText('Reload'));
		expect(reloadMock).toHaveBeenCalledOnce();
	});

	it('renders both Try again and Reload buttons', () => {
		const { getByText } = render(BoundaryFallback, { props: { reset: vi.fn() } });
		expect(getByText('Try again')).toBeTruthy();
		expect(getByText('Reload')).toBeTruthy();
	});

	it('renders Try again and Reload in aside variant', () => {
		const { getByText } = render(BoundaryFallback, {
			props: { reset: vi.fn(), variant: 'aside' },
		});
		expect(getByText('Try again')).toBeTruthy();
		expect(getByText('Reload')).toBeTruthy();
	});
});
