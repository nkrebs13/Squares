import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// Validate required environment variables at startup
function requireEnv(name: string): string {
	const value = Deno.env.get(name);
	if (!value) throw new Error(`Missing required environment variable: ${name}`);
	return value;
}

const VAPID_PRIVATE_KEY = requireEnv('VAPID_PRIVATE_KEY');
const VAPID_PUBLIC_KEY = requireEnv('VITE_VAPID_PUBLIC_KEY');
const SUPABASE_URL = requireEnv('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY = requireEnv('SUPABASE_SERVICE_ROLE_KEY');

interface PushPayload {
	party_id: string;
	title: string;
	body: string;
	url?: string;
	/** If set, only send to this player (for targeted notifications like winner alerts) */
	target_player?: string;
}

interface Subscription {
	id: string;
	endpoint: string;
	p256dh: string;
	auth: string;
	player_name: string;
}

// Web Push requires signing with VAPID. We use the Web Crypto API available in Deno.
// This implements a minimal Web Push sender following RFC 8291 + RFC 8292.

function base64UrlDecode(str: string): Uint8Array {
	const padding = '='.repeat((4 - (str.length % 4)) % 4);
	const base64 = (str + padding).replace(/-/g, '+').replace(/_/g, '/');
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function base64UrlEncode(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function importVapidKeys() {
	const privateKeyBytes = base64UrlDecode(VAPID_PRIVATE_KEY);
	const publicKeyBytes = base64UrlDecode(VAPID_PUBLIC_KEY);

	const privateKey = await crypto.subtle.importKey(
		'jwk',
		{
			kty: 'EC',
			crv: 'P-256',
			d: base64UrlEncode(privateKeyBytes),
			x: base64UrlEncode(publicKeyBytes.slice(1, 33)),
			y: base64UrlEncode(publicKeyBytes.slice(33, 65)),
		},
		{ name: 'ECDSA', namedCurve: 'P-256' },
		false,
		['sign']
	);

	return { privateKey, publicKeyBytes };
}

async function createVapidAuthHeader(audience: string): Promise<string> {
	const { privateKey, publicKeyBytes } = await importVapidKeys();

	const header = { typ: 'JWT', alg: 'ES256' };
	const now = Math.floor(Date.now() / 1000);
	const payload = {
		aud: audience,
		exp: now + 12 * 60 * 60, // 12 hours
		sub: 'mailto:noreply@footballsquares.app',
	};

	const headerB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
	const payloadB64 = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
	const unsignedToken = `${headerB64}.${payloadB64}`;

	const signature = await crypto.subtle.sign(
		{ name: 'ECDSA', hash: 'SHA-256' },
		privateKey,
		new TextEncoder().encode(unsignedToken)
	);

	// Convert DER signature to raw r||s format (64 bytes)
	const sigBytes = new Uint8Array(signature);
	let rawSig: Uint8Array;
	if (sigBytes.length === 64) {
		rawSig = sigBytes;
	} else {
		// DER encoded — extract r and s
		rawSig = derToRaw(sigBytes);
	}

	const jwt = `${unsignedToken}.${base64UrlEncode(rawSig)}`;
	const vapidPublicB64 = base64UrlEncode(publicKeyBytes);

	return `vapid t=${jwt}, k=${vapidPublicB64}`;
}

function derToRaw(der: Uint8Array): Uint8Array {
	// DER format: 0x30 [len] 0x02 [rLen] [r] 0x02 [sLen] [s]
	const raw = new Uint8Array(64);
	let offset = 2; // skip 0x30 and total length

	// Read r
	offset++; // skip 0x02
	const rLen = der[offset++];
	const rStart = rLen > 32 ? offset + (rLen - 32) : offset;
	const rDest = rLen > 32 ? 0 : 32 - rLen;
	raw.set(der.slice(rStart, offset + rLen), rDest);
	offset += rLen;

	// Read s
	offset++; // skip 0x02
	const sLen = der[offset++];
	const sStart = sLen > 32 ? offset + (sLen - 32) : offset;
	const sDest = sLen > 32 ? 32 : 64 - sLen;
	raw.set(der.slice(sStart, offset + sLen), sDest);

	return raw;
}

// Encrypt payload using Web Push encryption (aesgcm content encoding)
// Note: This uses the older aesgcm scheme (draft-ietf-webpush-encryption), not
// the newer aes128gcm scheme defined in RFC 8291. Both are widely supported.
async function encryptPayload(
	payload: string,
	p256dhKey: string,
	authSecret: string
): Promise<{ encrypted: Uint8Array; localPublicKey: Uint8Array; salt: Uint8Array }> {
	const subscriberPublicKey = base64UrlDecode(p256dhKey);
	const subscriberAuth = base64UrlDecode(authSecret);

	// Generate local ECDH key pair
	const localKeyPair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits']
	);

	// Export local public key (uncompressed point)
	const localPublicKeyRaw = new Uint8Array(
		await crypto.subtle.exportKey('raw', localKeyPair.publicKey)
	);

	// Import subscriber public key
	const subscriberKey = await crypto.subtle.importKey(
		'raw',
		subscriberPublicKey,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[]
	);

	// ECDH shared secret
	const sharedSecret = new Uint8Array(
		await crypto.subtle.deriveBits(
			{ name: 'ECDH', public: subscriberKey },
			localKeyPair.privateKey,
			256
		)
	);

	// Generate salt
	const salt = crypto.getRandomValues(new Uint8Array(16));

	// HKDF to derive encryption key and nonce
	const authInfo = new TextEncoder().encode('Content-Encoding: auth\0');
	const ikm = await hkdf(subscriberAuth, sharedSecret, authInfo, 32);

	const keyInfo = createInfo('aesgcm', subscriberPublicKey, localPublicKeyRaw);
	const contentEncryptionKey = await hkdf(salt, ikm, keyInfo, 16);

	const nonceInfo = createInfo('nonce', subscriberPublicKey, localPublicKeyRaw);
	const nonce = await hkdf(salt, ikm, nonceInfo, 12);

	// Pad and encrypt
	const paddedPayload = new Uint8Array(2 + new TextEncoder().encode(payload).length);
	paddedPayload.set([0, 0]); // 2 bytes padding length (0 = no padding)
	paddedPayload.set(new TextEncoder().encode(payload), 2);

	const aesKey = await crypto.subtle.importKey(
		'raw',
		contentEncryptionKey,
		{ name: 'AES-GCM' },
		false,
		['encrypt']
	);

	const encrypted = new Uint8Array(
		await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, paddedPayload)
	);

	return { encrypted, localPublicKey: localPublicKeyRaw, salt };
}

function createInfo(
	type: string,
	subscriberPublicKey: Uint8Array,
	localPublicKey: Uint8Array
): Uint8Array {
	const encoder = new TextEncoder();
	const typeEncoded = encoder.encode(`Content-Encoding: ${type}\0`);
	const p256dhLabel = encoder.encode('P-256\0');

	const info = new Uint8Array(
		typeEncoded.length +
			p256dhLabel.length +
			2 +
			subscriberPublicKey.length +
			2 +
			localPublicKey.length
	);

	let offset = 0;
	info.set(typeEncoded, offset);
	offset += typeEncoded.length;
	info.set(p256dhLabel, offset);
	offset += p256dhLabel.length;
	info[offset++] = 0;
	info[offset++] = subscriberPublicKey.length;
	info.set(subscriberPublicKey, offset);
	offset += subscriberPublicKey.length;
	info[offset++] = 0;
	info[offset++] = localPublicKey.length;
	info.set(localPublicKey, offset);

	return info;
}

async function hkdf(
	salt: Uint8Array,
	ikm: Uint8Array,
	info: Uint8Array,
	length: number
): Promise<Uint8Array> {
	// Extract
	const prk = new Uint8Array(
		await crypto.subtle.sign(
			'HMAC',
			await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, [
				'sign',
			]),
			ikm
		)
	);

	// Expand
	const prkKey = await crypto.subtle.importKey(
		'raw',
		prk,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const infoWithCounter = new Uint8Array(info.length + 1);
	infoWithCounter.set(info);
	infoWithCounter[info.length] = 1;
	const result = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, infoWithCounter));

	return result.slice(0, length);
}

async function sendPushNotification(
	subscription: Subscription,
	payload: PushPayload
): Promise<{ success: boolean; expired?: boolean }> {
	const body = JSON.stringify({
		title: payload.title,
		body: payload.body,
		url: payload.url || '/',
	});

	try {
		const { encrypted, localPublicKey, salt } = await encryptPayload(
			body,
			subscription.p256dh,
			subscription.auth
		);

		const endpointUrl = new URL(subscription.endpoint);
		const audience = `${endpointUrl.protocol}//${endpointUrl.host}`;
		const authorization = await createVapidAuthHeader(audience);

		const response = await fetch(subscription.endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/octet-stream',
				'Content-Encoding': 'aesgcm',
				Authorization: authorization,
				'Crypto-Key': `dh=${base64UrlEncode(localPublicKey)}`,
				Encryption: `salt=${base64UrlEncode(salt)}`,
				TTL: '86400',
			},
			body: encrypted,
		});

		if (response.status === 201 || response.status === 200) {
			return { success: true };
		}

		// 410 Gone or 404 = subscription expired
		if (response.status === 410 || response.status === 404) {
			return { success: false, expired: true };
		}

		const endpointSnippet = subscription.endpoint.slice(0, 40) + '...';
		console.error(`Push failed for ${endpointSnippet}: ${response.status}`);
		return { success: false };
	} catch (err) {
		const snippet = subscription.endpoint.slice(0, 40) + '...';
		console.error(`Push error for ${snippet}:`, err);
		return { success: false };
	}
}

Deno.serve(async (req) => {
	// Only allow POST
	if (req.method !== 'POST') {
		return new Response('Method not allowed', { status: 405 });
	}

	// Verify authorization (service role key or a shared secret)
	const authHeader = req.headers.get('Authorization');
	if (!authHeader || !authHeader.startsWith('Bearer ')) {
		return new Response('Unauthorized', { status: 401 });
	}

	const token = authHeader.replace('Bearer ', '');
	if (token !== SUPABASE_SERVICE_ROLE_KEY) {
		return new Response('Unauthorized', { status: 401 });
	}

	let payload: PushPayload;
	try {
		payload = await req.json();
	} catch {
		return new Response('Invalid JSON', { status: 400 });
	}

	if (!payload.party_id || !payload.title) {
		return new Response('Missing party_id or title', { status: 400 });
	}

	// Input validation
	const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (!uuidRegex.test(payload.party_id)) {
		return new Response('Invalid party_id', { status: 400 });
	}
	if (payload.title.length > 100 || (payload.body && payload.body.length > 500)) {
		return new Response('Payload too large', { status: 400 });
	}
	if (payload.url && (!payload.url.startsWith('/') || payload.url.startsWith('//'))) {
		return new Response('Invalid url — must be a relative path', { status: 400 });
	}

	const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

	// Fetch subscriptions for this party
	let query = supabase
		.from('push_subscriptions')
		.select('id, endpoint, p256dh, auth, player_name')
		.eq('party_id', payload.party_id);

	if (payload.target_player) {
		query = query.eq('player_name_lower', payload.target_player.toLowerCase());
	}

	const { data: subscriptions, error } = await query;

	if (error) {
		console.error('Failed to fetch subscriptions:', error);
		return new Response(JSON.stringify({ error: 'Failed to fetch subscriptions' }), {
			status: 500,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	if (!subscriptions || subscriptions.length === 0) {
		return new Response(JSON.stringify({ sent: 0, failed: 0 }), {
			headers: { 'Content-Type': 'application/json' },
		});
	}

	// Send push to all matching subscriptions
	const results = await Promise.allSettled(
		subscriptions.map((sub: Subscription) => sendPushNotification(sub, payload))
	);

	// Clean up expired subscriptions
	const expiredIds: string[] = [];
	let sent = 0;
	let failed = 0;

	results.forEach((result, index) => {
		if (result.status === 'fulfilled') {
			if (result.value.success) {
				sent++;
			} else {
				failed++;
				if (result.value.expired) {
					expiredIds.push(subscriptions[index].id);
				}
			}
		} else {
			failed++;
		}
	});

	// Delete expired subscriptions
	if (expiredIds.length > 0) {
		await supabase.from('push_subscriptions').delete().in('id', expiredIds);
	}

	return new Response(JSON.stringify({ sent, failed, expired_cleaned: expiredIds.length }), {
		headers: { 'Content-Type': 'application/json' },
	});
});
