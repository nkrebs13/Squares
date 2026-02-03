// Push notification handler — imported by the generated service worker
self.addEventListener('push', (event) => {
	if (!event.data) return;

	let data;
	try {
		data = event.data.json();
	} catch {
		data = { title: 'Football Squares', body: event.data.text() };
	}

	const options = {
		body: data.body || '',
		icon: '/icons/icon-192.png',
		badge: '/icons/icon-192.png',
		data: {
			url: data.url || '/',
		},
		vibrate: [200, 100, 200],
	};

	event.waitUntil(
		self.registration
			.showNotification(data.title || 'Football Squares', options)
			.catch(() => {
				// Notification failed (quota exceeded, permission revoked, etc.)
			})
	);
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();

	// Only allow relative paths — reject absolute/protocol-relative URLs
	const rawUrl = event.notification.data?.url || '/';
	const url = (rawUrl.startsWith('/') && !rawUrl.startsWith('//')) ? rawUrl : '/';
	if (url !== rawUrl) {
		console.warn('Push notification had invalid URL, falling back to /:', rawUrl);
	}

	event.waitUntil(
		// Try to focus existing window, otherwise open new one
		self.clients
			.matchAll({ type: 'window', includeUncontrolled: true })
			.then((clientList) => {
				for (const client of clientList) {
					if (new URL(client.url).pathname === url && 'focus' in client) {
						return client.focus();
					}
				}
				return self.clients.openWindow(url);
			})
	);
});
