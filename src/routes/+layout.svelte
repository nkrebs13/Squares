<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import ToastContainer from '$lib/components/ToastContainer.svelte';
	import { requestPersistentStorage } from '$lib/storage';

	const { children } = $props();

	onMount(async () => {
		if (browser) {
			// Request persistent storage for better data durability
			requestPersistentStorage();

			try {
				// @ts-ignore - PWA virtual modules are generated at build time
				const { pwaInfo } = await import('virtual:pwa-info');
				if (pwaInfo) {
					// @ts-ignore
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
	<meta name="theme-color" content="#0f0f14" />
	<link rel="manifest" href="/manifest.webmanifest" />
	<link rel="apple-touch-icon" href="/icons/icon.svg" />
	<link rel="icon" type="image/svg+xml" href="/icons/icon.svg" />
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
