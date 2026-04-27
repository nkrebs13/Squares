<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import { requestPersistentStorage } from '$lib/storage';
	import { APP_CONFIG } from '$lib/config';

	const { children } = $props();

	onMount(async () => {
		if (browser) {
			// Request persistent storage for better data durability
			requestPersistentStorage();

			try {
				// @ts-expect-error PWA virtual modules are generated at build time, not available to TypeScript
				const { pwaInfo } = await import('virtual:pwa-info');
				if (pwaInfo) {
					// @ts-expect-error PWA virtual module generated at build time
					const { registerSW } = await import('virtual:pwa-register');
					registerSW({
						immediate: true,
					});
				}
			} catch {
				// PWA not available in dev mode
			}
		}
	});
</script>

<svelte:head>
	<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
	<meta name="theme-color" content="#1a2744" />
	<link rel="manifest" href="/manifest.webmanifest" />

	<!-- Default OG tags -->
	<meta property="og:title" content={APP_CONFIG.appName} />
	<meta property="og:description" content={APP_CONFIG.appDescription} />
	<meta property="og:type" content="website" />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={APP_CONFIG.appName} />
	<meta name="twitter:description" content={APP_CONFIG.appDescription} />

	<!-- Favicons - best practices -->
	<link rel="icon" href="/favicon.ico" sizes="32x32" />
	<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
	<link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16x16.png" />
	<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32x32.png" />
	<link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
</svelte:head>

<!-- Aurora animated background -->
<div class="aurora-bg">
	<div class="aurora-gradient"></div>
	<div class="aurora-gradient-2"></div>
</div>

<div class="min-h-screen safe-top safe-bottom relative">
	{@render children()}
</div>

<ToastContainer />
