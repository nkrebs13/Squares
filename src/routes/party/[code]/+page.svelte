<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import SimpleGrid from '$lib/components/SimpleGrid.svelte';
	import GridSkeleton from '$lib/components/GridSkeleton.svelte';
	import GestureHint from '$lib/components/GestureHint.svelte';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import BoundaryFallback from '$lib/components/BoundaryFallback.svelte';
	import PartySidebar from '$lib/components/PartySidebar.svelte';
	import { loadParty, subscribeToParty, cleanup, party, isLoading, error } from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import {
		buildPartyCanonicalUrl,
		buildPartyPageTitle,
		buildPartyShareDescription,
		partyToShareMetadata,
	} from '$lib/partyMeta';
	import {
		saveRecentParty,
		hasHostPin,
		partyPinKey,
		partyNicknameKey,
		getSessionItem,
		removeSessionItem,
	} from '$lib/storage';
	import { APP_CONFIG } from '$lib/config';
	import type { RecentParty } from '$lib/types';
	import type { PartyShareMetadata } from '$lib/partyMeta';

	const { data = { partyMeta: null } } = $props<{
		data?: { partyMeta: PartyShareMetadata | null };
	}>();
	const code = $derived($page.params.code ?? '');
	let unsubscribe: (() => void) | null = null;
	const matchupLabel = $derived($party ? `${$party.team_row_name} vs ${$party.team_col_name}` : '');
	const shareMeta = $derived($party ? partyToShareMetadata($party) : data.partyMeta);
	const pageTitle = $derived(buildPartyPageTitle(shareMeta));
	const pageDescription = $derived(buildPartyShareDescription(shareMeta));
	const canonicalUrl = $derived(
		buildPartyCanonicalUrl(shareMeta?.code || code || APP_CONFIG.demoPartyCode)
	);

	// Check if user is host (has PIN stored)
	let isHost = $state(false);
	let gestureHintRef = $state<GestureHint | null>(null);

	async function checkIsHost() {
		if (browser && code) {
			// Check IndexedDB first, then fallback to sessionStorage
			isHost = (await hasHostPin(code)) || getSessionItem(partyPinKey(code)) !== null;
		}
	}

	async function saveToRecentParties() {
		if (!$party) return;

		// Check for nickname set during create/join flow
		let nickname: string | undefined;
		if (browser) {
			const nicknameKey = partyNicknameKey($party.code);
			nickname = getSessionItem(nicknameKey) || undefined;
			if (nickname) {
				removeSessionItem(nicknameKey);
			}
		}

		const recentParty: RecentParty = {
			code: $party.code,
			nickname,
			eventName: $party.event_name,
			kickoffAt: $party.kickoff_at,
			teamRowName: $party.team_row_name,
			teamColName: $party.team_col_name,
			lastVisited: Date.now(),
			status: $party.status,
			isHost,
		};

		await saveRecentParty(recentParty);
	}

	onMount(async () => {
		// Redirect to join if no name
		if (!$userName) {
			goto(`/join?code=${code}`);
			return;
		}

		await checkIsHost();

		const success = await loadParty(code);
		if (success && $party) {
			unsubscribe = subscribeToParty($party.id, $party.game_id);
			// Save to recent parties
			await saveToRecentParties();
		}
	});

	onDestroy(() => {
		if (unsubscribe) {
			unsubscribe();
		}
		cleanup();
	});
</script>

<svelte:head>
	<title>{pageTitle}</title>
	<meta name="description" content={pageDescription} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={pageTitle} />
	<meta property="og:description" content={pageDescription} />
	<meta name="twitter:card" content="summary" />
	<meta name="twitter:title" content={pageTitle} />
	<meta name="twitter:description" content={pageDescription} />
</svelte:head>

<div class="party-page">
	<ConnectionBanner />
	{#if $isLoading}
		<div class="flex items-center justify-center h-screen">
			<GridSkeleton />
		</div>
	{:else if $error}
		<div class="flex flex-col items-center justify-center h-screen gap-4">
			<p class="text-error">{$error}</p>
			<a href="/" class="btn btn-secondary">Go Home</a>
		</div>
	{:else if $party}
		{#snippet sidebarBoundaryFallback(_error: unknown, reset: () => void)}
			<BoundaryFallback {reset} variant="aside" />
		{/snippet}
		<header class="mb-4 flex justify-between items-start">
			<div>
				<a href="/" class="text-sm hover:opacity-100 text-secondary">← Home</a>
				<h1 class="text-2xl font-bold mt-1">
					{$party.event_name}
				</h1>
				<p class="mt-1 text-sm text-secondary">{matchupLabel}</p>
			</div>
			<div class="header-actions">
				{#if isHost}
					<a href="/party/{code}/admin" class="btn btn-secondary text-sm"> Host Panel </a>
				{/if}
				<button
					type="button"
					class="help-btn"
					onclick={() => gestureHintRef?.reopen()}
					aria-label="Show gesture help"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="12" cy="12" r="10"></circle>
						<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
						<line x1="12" y1="17" x2="12.01" y2="17"></line>
					</svg>
				</button>
			</div>
		</header>

		<!-- Desktop Two-Column Layout -->
		<div class="desktop-layout">
			<!-- Main Content (Grid) -->
			<svelte:boundary>
				<div class="main-content">
					<!-- Mobile sidebar content (above grid) -->
					<div class="lg:hidden">
						<PartySidebar variant="mobile" />
					</div>

					<!-- Mounted at every breakpoint: the header's help button calls reopen() on it,
					     and GestureHint picks touch vs pointer copy itself. Nesting it in the
					     lg:hidden wrapper above would make that button dead on desktop. -->
					<GestureHint bind:this={gestureHintRef} />

					<!-- Main Grid -->
					<div class="mb-4 lg:mb-0">
						<SimpleGrid />
					</div>
				</div>
				{#snippet failed(_error, reset)}
					<BoundaryFallback {reset} />
				{/snippet}
			</svelte:boundary>

			<!-- Desktop Sidebar -->
			<svelte:boundary failed={sidebarBoundaryFallback}>
				<aside class="sidebar hidden lg:block">
					<PartySidebar variant="desktop" />
				</aside>
			</svelte:boundary>
		</div>
	{/if}
</div>

<style>
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.help-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		color: var(--text-secondary);
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.help-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.help-btn:focus-visible {
		outline: 2px solid rgba(100, 210, 200, 0.9);
		outline-offset: 2px;
	}

	/* Mobile-first: viewport-fitting layout */
	.party-page {
		min-height: 100vh;
		min-height: 100dvh; /* Dynamic viewport height for mobile browsers */
		display: flex;
		flex-direction: column;
		padding: 1rem;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		overflow-x: hidden; /* Prevent horizontal page scroll */
	}

	/* On mobile, lock to viewport and prevent vertical scroll when possible */
	@media (max-width: 1023px) {
		.party-page {
			height: 100vh;
			height: 100dvh;
			overflow-y: auto;
			-webkit-overflow-scrolling: touch;
		}

		/* Grid container should take available space */
		.main-content {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-height: 0; /* Allow flex shrinking */
		}

		/* Grid wrapper needs to expand */
		.main-content > :global(div:has(.grid-wrapper)) {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-height: 0;
		}
	}

	/* Desktop two-column layout */
	@media (min-width: 1024px) {
		.party-page {
			padding-bottom: 1rem;
		}

		.desktop-layout {
			display: flex;
			gap: 1.5rem;
			align-items: flex-start;
		}

		.main-content {
			flex: 1;
			min-width: 0;
		}

		.sidebar {
			width: 340px;
			max-width: 400px;
			flex-shrink: 0;
		}
	}

	/* Larger desktop - wider sidebar */
	@media (min-width: 1280px) {
		.sidebar {
			width: 380px;
		}
	}
</style>
