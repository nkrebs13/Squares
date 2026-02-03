import { browser } from '$app/environment';
import { getSupabaseClient } from '$lib/supabase';

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY;

function urlBase64ToUint8Array(base64String: string): Uint8Array {
	const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; ++i) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}

export function isPushSupported(): boolean {
	if (!browser) return false;
	return 'serviceWorker' in navigator && 'PushManager' in window && !!VAPID_PUBLIC_KEY;
}

export async function getPushPermission(): Promise<NotificationPermission> {
	if (!browser) return 'default';
	return Notification.permission;
}

export async function subscribeToPush(
	partyId: string,
	playerName: string
): Promise<{ success: boolean; error?: string }> {
	if (!isPushSupported()) {
		return { success: false, error: 'Push notifications not supported' };
	}

	try {
		const permission = await Notification.requestPermission();
		if (permission !== 'granted') {
			return { success: false, error: 'Permission denied' };
		}

		if (!VAPID_PUBLIC_KEY) {
			return { success: false, error: 'Push notifications not configured' };
		}

		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
		});

		const json = subscription.toJSON();
		if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) {
			return { success: false, error: 'Invalid subscription' };
		}

		// Save to Supabase
		const supabase = getSupabaseClient();
		const { error } = await supabase.from('push_subscriptions').upsert(
			{
				party_id: partyId,
				player_name: playerName,
				endpoint: json.endpoint,
				p256dh: json.keys.p256dh,
				auth: json.keys.auth,
			},
			{ onConflict: 'party_id,endpoint' }
		);

		if (error) {
			return { success: false, error: 'Failed to save subscription' };
		}

		return { success: true };
	} catch {
		return { success: false, error: 'Failed to subscribe' };
	}
}

export async function unsubscribeFromPush(partyId: string): Promise<void> {
	if (!browser) return;

	try {
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		if (subscription) {
			const endpoint = subscription.endpoint;
			await subscription.unsubscribe();

			// Remove from Supabase
			const supabase = getSupabaseClient();
			await supabase
				.from('push_subscriptions')
				.delete()
				.eq('party_id', partyId)
				.eq('endpoint', endpoint);
		}
	} catch {
		// Unsubscribe failed silently
	}
}

export async function isSubscribed(): Promise<boolean> {
	if (!browser || !isPushSupported()) return false;

	try {
		const registration = await navigator.serviceWorker.ready;
		const subscription = await registration.pushManager.getSubscription();
		return !!subscription;
	} catch {
		return false;
	}
}
