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
		it('displays all gesture hints', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Double-tap to zoom')).toBeInTheDocument();
				expect(screen.getByText('Tap to claim')).toBeInTheDocument();
				expect(screen.getByText('Hold to select multiple')).toBeInTheDocument();
			});
		});

		it('displays dismiss instructions', async () => {
			mockHasSeenGestureHint.mockResolvedValue(false);

			render(GestureHint);
			await vi.waitFor(() => {
				expect(screen.getByText('Tap to dismiss')).toBeInTheDocument();
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
});
