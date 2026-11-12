import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockSupabaseClient } from '../setup';

// Mock subscription object
const mockSubscription = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
	toJSON: () => ({
		endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
		keys: {
			p256dh: 'test-p256dh-key',
			auth: 'test-auth-key',
		},
	}),
	unsubscribe: vi.fn().mockResolvedValue(true),
};

const mockPushManager = {
	subscribe: vi.fn().mockResolvedValue(mockSubscription),
	getSubscription: vi.fn().mockResolvedValue(null),
};

const mockRegistration = {
	pushManager: mockPushManager,
};

// Set up navigator.serviceWorker before module import
Object.defineProperty(navigator, 'serviceWorker', {
	value: {
		ready: Promise.resolve(mockRegistration),
	},
	writable: true,
	configurable: true,
});

// Mock PushManager and Notification on window
vi.stubGlobal('PushManager', class {});
vi.stubGlobal('Notification', {
	permission: 'default' as NotificationPermission,
	requestPermission: vi.fn().mockResolvedValue('granted' as NotificationPermission),
});

// push.ts reads VITE_VAPID_PUBLIC_KEY at import time, so stub it before importing.
vi.stubEnv(
	'VITE_VAPID_PUBLIC_KEY',
	'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'
);
const { isPushSupported, subscribeToPush, isSubscribed, getPushPermission } =
	await import('$lib/push');

describe('Push Notification Module', () => {
	beforeEach(() => {
		mockPushManager.subscribe.mockResolvedValue(mockSubscription);
		mockPushManager.getSubscription.mockResolvedValue(null);
		mockSubscription.unsubscribe.mockResolvedValue(true);
		(Notification as unknown as { permission: string }).permission = 'default';
		(Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('granted');
	});

	describe('isPushSupported', () => {
		it('returns true when service worker and PushManager available', () => {
			expect(isPushSupported()).toBe(true);
		});
	});

	describe('getPushPermission', () => {
		it('returns current notification permission', () => {
			(Notification as unknown as { permission: string }).permission = 'granted';
			expect(getPushPermission()).toBe('granted');
		});

		it('returns default when not yet asked', () => {
			(Notification as unknown as { permission: string }).permission = 'default';
			expect(getPushPermission()).toBe('default');
		});
	});

	describe('subscribeToPush', () => {
		it('requests permission and saves the subscription through the RPC', async () => {
			mockSupabaseClient.rpc.mockResolvedValue({ data: true, error: null });

			const result = await subscribeToPush('party-123', 'Alice');

			expect(Notification.requestPermission).toHaveBeenCalled();
			expect(mockPushManager.subscribe).toHaveBeenCalledWith({
				userVisibleOnly: true,
				applicationServerKey: expect.any(Uint8Array),
			});
			expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('save_push_subscription', {
				p_party_id: 'party-123',
				p_player_name: 'Alice',
				p_endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint',
				p_p256dh: 'test-p256dh-key',
				p_auth: 'test-auth-key',
			});
			expect(result).toEqual({ success: true });
		});

		it('reports a non-player as unable to subscribe', async () => {
			mockSupabaseClient.rpc.mockResolvedValue({ data: false, error: null });

			const result = await subscribeToPush('party-123', 'Mallory');

			expect(result).toEqual({ success: false, error: 'Claim a square to get notifications' });
		});

		it('returns error when permission denied', async () => {
			(Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValue('denied');

			const result = await subscribeToPush('party-123', 'Alice');

			expect(result).toEqual({ success: false, error: 'Permission denied' });
			expect(mockPushManager.subscribe).not.toHaveBeenCalled();
		});

		it('returns error when subscription save fails', async () => {
			mockSupabaseClient.rpc.mockResolvedValue({ data: null, error: { message: 'DB error' } });

			const result = await subscribeToPush('party-123', 'Alice');

			expect(result).toEqual({ success: false, error: 'Failed to save subscription' });
		});
	});

	describe('isSubscribed', () => {
		it('returns true when subscription exists', async () => {
			mockPushManager.getSubscription.mockResolvedValue(mockSubscription);

			expect(await isSubscribed()).toBe(true);
		});

		it('returns false when no subscription', async () => {
			mockPushManager.getSubscription.mockResolvedValue(null);

			expect(await isSubscribed()).toBe(false);
		});
	});
});
