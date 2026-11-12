import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { tick } from 'svelte';

import GestureHint from '$lib/components/GestureHint.svelte';
import { get as idbGet, set as idbSet } from 'idb-keyval';
import { DESKTOP_LAYOUT_QUERY } from '$lib/layout';

const HINT_KEY = 'squares_gesture_hint_shown';

/** Whether the browser has already recorded the hint as seen. */
function hintAlreadySeen(seen: boolean) {
	vi.mocked(idbGet).mockImplementation(
		(key) => Promise.resolve(key === HINT_KEY ? seen : undefined) as never
	);
}

const timesMarkedSeen = () =>
	vi.mocked(idbSet).mock.calls.filter(([key, value]) => key === HINT_KEY && value === true).length;

// The matchMedia mock answers the layout query and the `(pointer: coarse)` touch query
// independently; any query not listed is false (mobile layout, mouse pointer).

function createMatchMediaMock(queryMatches: Record<string, boolean>) {
	return vi.fn().mockImplementation((query: string) => ({
		matches: queryMatches[query] ?? false,
		media: query,
	}));
}

// Waits for onMount's async `hasSeenGestureHint()` check to be invoked and for the
// resulting state change (or lack thereof) to flush to the DOM. A bare `vi.waitFor`
// on a negative assertion (".not.toBeInTheDocument()") is a false-negative trap: it
// resolves on its very first synchronous check, before the async mount logic has had
// a chance to run, so it can't actually prove the hint stayed hidden.
async function waitForMountDecision() {
	await vi.waitFor(() => {
		expect(vi.mocked(idbGet)).toHaveBeenCalledWith(HINT_KEY);
	});
	await tick();
}

describe('GestureHint Component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: mobile-width layout, non-touch pointer. Individual tests override
		// this before calling render() when they need a different breakpoint/pointer.
		window.matchMedia = createMatchMediaMock({});
	});

	afterEach(() => {
		// @ts-expect-error - cleaning up the test-only override between tests
		delete window.matchMedia;
	});

	describe('Visibility', () => {
		it('shows the hint when user has not seen it before, on a mobile-width layout', async () => {
			hintAlreadySeen(false);
			window.matchMedia = createMatchMediaMock({});

			render(GestureHint);
			// Wait for the async onMount to resolve
			await vi.waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});
		});

		it('does not show the hint when user has seen it before', async () => {
			hintAlreadySeen(true);

			render(GestureHint);
			await waitForMountDecision();

			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();
		});

		it('does not auto-show the hint on a desktop-width layout, even when unseen', async () => {
			hintAlreadySeen(false);
			window.matchMedia = createMatchMediaMock({ [DESKTOP_LAYOUT_QUERY]: true });

			render(GestureHint);
			await waitForMountDecision();

			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();
		});
	});

	describe('Content', () => {
		it('displays all gesture hints for non-touch (mouse) devices', async () => {
			hintAlreadySeen(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Tap Zoom to enlarge grid')).toBeInTheDocument();
				expect(screen.getByText('Click to claim')).toBeInTheDocument();
				expect(screen.getByText('Click again to unclaim your square')).toBeInTheDocument();
				expect(screen.getByText('Click and drag to select multiple')).toBeInTheDocument();
			});
			// Touch-only copy must not leak into the non-touch branch
			expect(screen.queryByText('Tap again to unclaim your square')).not.toBeInTheDocument();
		});

		it('displays touch-specific copy when the device reports coarse pointer', async () => {
			hintAlreadySeen(false);
			window.matchMedia = createMatchMediaMock({ '(pointer: coarse)': true });

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Tap Zoom to enlarge grid')).toBeInTheDocument();
				expect(screen.getByText('Tap to claim')).toBeInTheDocument();
				expect(screen.getByText('Tap again to unclaim your square')).toBeInTheDocument();
			});
			// Non-touch-only copy must not leak into the touch branch
			expect(screen.queryByText('Click to claim')).not.toBeInTheDocument();
			expect(screen.queryByText('Click and drag to select multiple')).not.toBeInTheDocument();
		});

		it('displays dismiss instructions', async () => {
			hintAlreadySeen(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Tap to dismiss')).toBeInTheDocument();
			});
		});

		it('announces itself to screen readers when shown', async () => {
			hintAlreadySeen(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByRole('status')).toHaveTextContent('Tap to dismiss');
			});
		});
	});

	describe('Dismissal', () => {
		it('hides and persists when clicked', async () => {
			hintAlreadySeen(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});

			await fireEvent.click(screen.getByRole('button', { name: /Tap to dismiss/ }));

			expect(timesMarkedSeen()).toBe(1);
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();
		});

		it('auto-dismisses after 5 seconds', async () => {
			vi.useFakeTimers();
			hintAlreadySeen(false);

			render(GestureHint);

			// Wait for mount
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();

			// Advance past 5 second auto-dismiss
			await vi.advanceTimersByTimeAsync(5000);

			expect(timesMarkedSeen()).toBe(1);
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();

			vi.useRealTimers();
		});
	});

	describe('Reopen (help affordance)', () => {
		it('re-shows the hint via the exported reopen() after it was dismissed', async () => {
			hintAlreadySeen(true); // already seen -> not shown on mount

			const { component } = render(GestureHint);
			await waitForMountDecision();
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();

			component.reopen();

			await vi.waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});
		});

		it('re-shows the hint via reopen() on a desktop-width layout (the "?" help button works everywhere)', async () => {
			hintAlreadySeen(true);
			window.matchMedia = createMatchMediaMock({ [DESKTOP_LAYOUT_QUERY]: true });

			const { component } = render(GestureHint);
			await waitForMountDecision();
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();

			component.reopen();

			await vi.waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});
		});

		it('does not clear the persisted seen-flag when reopened', async () => {
			hintAlreadySeen(true);

			const { component } = render(GestureHint);
			await waitForMountDecision();
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();

			component.reopen();
			await vi.waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});

			// reopen() itself must not touch storage - only an explicit dismiss does
			expect(timesMarkedSeen()).toBe(0);
		});

		it('still auto-dismisses 5 seconds after being reopened', async () => {
			vi.useFakeTimers();
			hintAlreadySeen(true);

			const { component } = render(GestureHint);
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();

			component.reopen();
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();

			await vi.advanceTimersByTimeAsync(5000);

			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();
			expect(timesMarkedSeen()).toBe(1);

			vi.useRealTimers();
		});
	});
});
