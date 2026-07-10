import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// Must mock before importing the component
vi.mock('$lib/storage', () => ({
	hasSeenGestureHint: vi.fn().mockResolvedValue(true),
	markGestureHintSeen: vi.fn().mockResolvedValue(undefined),
	getUserName: vi.fn().mockResolvedValue(null),
	setUserName: vi.fn().mockResolvedValue(undefined),
	clearUserName: vi.fn().mockResolvedValue(undefined),
}));

import GestureHint from '$lib/components/GestureHint.svelte';
import { hasSeenGestureHint, markGestureHintSeen } from '$lib/storage';

const mockHasSeenGestureHint = vi.mocked(hasSeenGestureHint);
const mockMarkGestureHintSeen = vi.mocked(markGestureHintSeen);

describe('GestureHint Component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Visibility', () => {
		it('shows the hint when user has not seen it before', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);

			render(GestureHint);
			// Wait for the async onMount to resolve
			await vi.waitFor(() => {
				expect(screen.getByLabelText('Dismiss hint')).toBeInTheDocument();
			});
		});

		it('does not show the hint when user has seen it before', async () => {
			mockHasSeenGestureHint.mockResolvedValue(true);

			render(GestureHint);
			// Give time for async mount
			await vi.waitFor(
				() => {
					expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();
				},
				{ timeout: 100 }
			);
		});
	});

	describe('Content', () => {
		it('displays all gesture hints for non-touch (mouse) devices', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);

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
			mockHasSeenGestureHint.mockResolvedValue(false);
			window.matchMedia = vi.fn().mockReturnValue({ matches: true });

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Tap Zoom to enlarge grid')).toBeInTheDocument();
				expect(screen.getByText('Tap to claim')).toBeInTheDocument();
				expect(screen.getByText('Tap again to unclaim your square')).toBeInTheDocument();
			});
			// Non-touch-only copy must not leak into the touch branch
			expect(screen.queryByText('Click to claim')).not.toBeInTheDocument();
			expect(screen.queryByText('Click and drag to select multiple')).not.toBeInTheDocument();

			// @ts-expect-error - cleaning up the test-only override
			delete window.matchMedia;
		});

		it('displays dismiss instructions', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Tap to dismiss')).toBeInTheDocument();
			});
		});

		it('announces itself to screen readers when shown', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByRole('status')).toBeInTheDocument();
			});
		});
	});

	describe('Dismissal', () => {
		it('hides and persists when clicked', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);
			mockMarkGestureHintSeen.mockResolvedValue(undefined);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByLabelText('Dismiss hint')).toBeInTheDocument();
			});

			await fireEvent.click(screen.getByLabelText('Dismiss hint'));

			expect(mockMarkGestureHintSeen).toHaveBeenCalledTimes(1);
			expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();
		});

		it('auto-dismisses after 5 seconds', async () => {
			vi.useFakeTimers();
			mockHasSeenGestureHint.mockResolvedValue(false);
			mockMarkGestureHintSeen.mockResolvedValue(undefined);

			render(GestureHint);

			// Wait for mount
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.getByLabelText('Dismiss hint')).toBeInTheDocument();

			// Advance past 5 second auto-dismiss
			await vi.advanceTimersByTimeAsync(5000);

			expect(mockMarkGestureHintSeen).toHaveBeenCalledTimes(1);
			expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();

			vi.useRealTimers();
		});
	});

	describe('Reopen (help affordance)', () => {
		it('re-shows the hint via the exported reopen() after it was dismissed', async () => {
			mockHasSeenGestureHint.mockResolvedValue(true); // already seen -> not shown on mount

			const { component } = render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();
			});

			component.reopen();

			await vi.waitFor(() => {
				expect(screen.getByLabelText('Dismiss hint')).toBeInTheDocument();
			});
		});

		it('does not clear the persisted seen-flag when reopened', async () => {
			mockHasSeenGestureHint.mockResolvedValue(true);

			const { component } = render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();
			});

			component.reopen();
			await vi.waitFor(() => {
				expect(screen.getByLabelText('Dismiss hint')).toBeInTheDocument();
			});

			// reopen() itself must not touch storage - only an explicit dismiss does
			expect(mockMarkGestureHintSeen).not.toHaveBeenCalled();
		});

		it('still auto-dismisses 5 seconds after being reopened', async () => {
			vi.useFakeTimers();
			mockHasSeenGestureHint.mockResolvedValue(true);
			mockMarkGestureHintSeen.mockResolvedValue(undefined);

			const { component } = render(GestureHint);
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();

			component.reopen();
			await vi.advanceTimersByTimeAsync(0);
			expect(screen.getByLabelText('Dismiss hint')).toBeInTheDocument();

			await vi.advanceTimersByTimeAsync(5000);

			expect(screen.queryByLabelText('Dismiss hint')).not.toBeInTheDocument();
			expect(mockMarkGestureHintSeen).toHaveBeenCalledTimes(1);

			vi.useRealTimers();
		});
	});
});
