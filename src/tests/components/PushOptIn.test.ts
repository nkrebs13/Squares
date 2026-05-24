import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// Mock push module
const mockIsPushSupported = vi.fn().mockReturnValue(true);
const mockSubscribeToPush = vi.fn().mockResolvedValue({ success: true });
const mockIsSubscribed = vi.fn().mockResolvedValue(false);
const mockGetPushPermission = vi.fn().mockResolvedValue('default');

vi.mock('$lib/push', () => ({
	isPushSupported: () => mockIsPushSupported(),
	subscribeToPush: (...args: unknown[]) => mockSubscribeToPush(...args),
	isSubscribed: () => mockIsSubscribed(),
	getPushPermission: () => mockGetPushPermission(),
}));

// Mock game store
vi.mock('$lib/stores/game', async () => {
	const { writable } = await import('svelte/store');
	return {
		party: writable({ id: 'party-123', code: 'ABC123' }),
	};
});

// Mock user store
vi.mock('$lib/stores/user', async () => {
	const { writable } = await import('svelte/store');
	return {
		userName: writable('Alice'),
	};
});

// Mock toast store
vi.mock('$lib/stores/toast', () => ({
	toast: {
		success: vi.fn(),
		error: vi.fn(),
	},
}));

import PushOptIn from '$lib/components/PushOptIn.svelte';
import { toast } from '$lib/stores/toast';

describe('PushOptIn Component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockIsPushSupported.mockReturnValue(true);
		mockSubscribeToPush.mockResolvedValue({ success: true });
		mockIsSubscribed.mockResolvedValue(false);
		mockGetPushPermission.mockResolvedValue('default');
	});

	it('renders enable notifications button when supported and not subscribed', async () => {
		render(PushOptIn);

		await vi.waitFor(() => {
			expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
		});
	});

	it('does not render when push is not supported', async () => {
		mockIsPushSupported.mockReturnValue(false);

		const { container } = render(PushOptIn);

		// Give time for async mount
		await vi.waitFor(() => {
			expect(container.querySelector('.push-opt-in')).not.toBeInTheDocument();
		});
	});

	it('does not render when already subscribed', async () => {
		mockIsSubscribed.mockResolvedValue(true);

		const { container } = render(PushOptIn);

		await vi.waitFor(() => {
			expect(container.querySelector('.push-opt-in')).not.toBeInTheDocument();
		});
	});

	it('does not render when permission is denied', async () => {
		mockGetPushPermission.mockResolvedValue('denied');

		const { container } = render(PushOptIn);

		await vi.waitFor(() => {
			expect(container.querySelector('.push-opt-in')).not.toBeInTheDocument();
		});
	});

	it('subscribes on click and shows success toast', async () => {
		render(PushOptIn);

		await vi.waitFor(() => {
			expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
		});

		await fireEvent.click(screen.getByText('Enable Notifications'));

		await vi.waitFor(() => {
			expect(mockSubscribeToPush).toHaveBeenCalledWith('party-123', 'Alice');
			expect(toast.success).toHaveBeenCalledWith('Notifications enabled!');
		});
	});

	it('shows error toast when subscription fails', async () => {
		mockSubscribeToPush.mockResolvedValue({ success: false, error: 'Failed to subscribe' });

		render(PushOptIn);

		await vi.waitFor(() => {
			expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
		});

		await fireEvent.click(screen.getByText('Enable Notifications'));

		await vi.waitFor(() => {
			expect(toast.error).toHaveBeenCalledWith('Failed to subscribe');
		});
	});

	it('hides button after permission denied', async () => {
		mockSubscribeToPush.mockResolvedValue({ success: false, error: 'Permission denied' });

		const { container } = render(PushOptIn);

		await vi.waitFor(() => {
			expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
		});

		await fireEvent.click(screen.getByText('Enable Notifications'));

		await vi.waitFor(() => {
			expect(container.querySelector('.push-opt-in')).not.toBeInTheDocument();
		});
	});

	it('shows Enabling... text while subscribing', async () => {
		// Make subscribe take time
		mockSubscribeToPush.mockImplementation(
			() => new Promise((resolve) => setTimeout(() => resolve({ success: true }), 100))
		);

		render(PushOptIn);

		await vi.waitFor(() => {
			expect(screen.getByText('Enable Notifications')).toBeInTheDocument();
		});

		await fireEvent.click(screen.getByText('Enable Notifications'));

		expect(screen.getByText('Enabling...')).toBeInTheDocument();
	});
});
