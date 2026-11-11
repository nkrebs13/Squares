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

	it('renders the error message', () => {
		const { getByText } = render(BoundaryFallback, { props: { reset: vi.fn() } });
		expect(getByText('This section encountered an error.')).toBeTruthy();
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
});
