<script lang="ts">
	import { APP_CONFIG } from '$lib/config';

	/**
	 * The one place a page's title and share tags are written, so each appears once per page.
	 * Site-wide tags (og:type, twitter:card, icons, manifest) stay in the root layout.
	 */
	interface Props {
		/** Browser tab title. */
		title?: string;
		/** og:title / twitter:title when it differs from the tab title. */
		shareTitle?: string;
		description?: string;
		/** Canonical URL; also sent as og:url. */
		url?: string;
	}

	const {
		title = APP_CONFIG.appName,
		shareTitle = title,
		description = APP_CONFIG.appDescription,
		url,
	}: Props = $props();
</script>

<svelte:head>
	<title>{title}</title>
	<meta name="description" content={description} />
	{#if url}
		<link rel="canonical" href={url} />
		<meta property="og:url" content={url} />
	{/if}
	<meta property="og:title" content={shareTitle} />
	<meta property="og:description" content={description} />
	<meta name="twitter:title" content={shareTitle} />
	<meta name="twitter:description" content={description} />
</svelte:head>
