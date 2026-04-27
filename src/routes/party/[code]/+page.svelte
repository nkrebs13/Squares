<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import SimpleGrid from '$lib/components/SimpleGrid.svelte';
	import GridSkeleton from '$lib/components/GridSkeleton.svelte';
	import GestureHint from '$lib/components/GestureHint.svelte';
	import BoundaryFallback from '$lib/components/BoundaryFallback.svelte';
	import PartySidebar from '$lib/components/PartySidebar.svelte';
	import { loadParty, subscribeToParty, cleanup, party, isLoading, error } from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import { saveRecentParty, hasHostPin } from '$lib/storage';
	import type { RecentParty } from '$lib/types';

	const code = $derived($page.params.code ?? '');
	let unsubscribe: (() => void) | null = null;

	// Check if user is host (has PIN stored)
	let isHost = $state(false);

	async function checkIsHost() {
		if (browser && code) {
			// Check IndexedDB first, then fallback to sessionStorage
			isHost = (await hasHostPin(code)) || sessionStorage.getItem(`squares_pin_${code}`) !== null;
		}
	}

	async function saveToRecentParties() {
		if (!$party) return;

		// Check for nickname set during create/join flow
		let nickname: string | undefined;
		if (browser) {
			const nicknameKey = `squares_nickname_${$party.code}`;
			nickname = sessionStorage.getItem(nicknameKey) || undefined;
			if (nickname) {
				sessionStorage.removeItem(nicknameKey);
			}
		}

		const recentParty: RecentParty = {
			code: $party.code,
			nickname,
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
	<title
		>{$party
			? `Football Squares — ${$party.team_row_name} vs ${$party.team_col_name}`
			: 'Football Squares'}</title
	>
	<meta
		property="og:title"
		content={$party
			? `Football Squares — ${$party.team_row_name} vs ${$party.team_col_name}`
			: 'Football Squares'}
	/>
	<meta property="og:description" content="Claim your squares for the big game!" />
	<meta name="twitter:card" content="summary" />
	<meta
		name="twitter:title"
		content={$party
			? `Football Squares — ${$party.team_row_name} vs ${$party.team_col_name}`
			: 'Football Squares'}
	/>
	<meta name="twitter:description" content="Claim your squares for the big game!" />
</svelte:head>

<div class="party-page">
	{#if $isLoading}
		<div class="flex items-center justify-center h-screen">
			<GridSkeleton />
		</div>
	{:else if $error}
		<div class="flex flex-col items-center justify-center h-screen gap-4">
			<p style="color: #fca5a5">{$error}</p>
			<a href="/" class="btn btn-secondary">Go Home</a>
		</div>
	{:else if $party}
		{#snippet sidebarBoundaryFallback(_error: unknown, reset: () => void)}
			<BoundaryFallback {reset} variant="aside" />
		{/snippet}
		<header class="mb-4 flex justify-between items-start">
			<div>
				<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Home</a
				>
				<h1 class="text-2xl font-bold mt-1">
					{$party.team_row_name} vs {$party.team_col_name}
				</h1>
			</div>
			{#if isHost}
				<a href="/party/{code}/admin" class="btn btn-secondary text-sm"> Host Panel </a>
			{/if}
		</header>

		<!-- Desktop Two-Column Layout -->
		<div class="desktop-layout">
			<!-- Main Content (Grid) -->
			<svelte:boundary>
				<div class="main-content">
					<!-- Mobile sidebar content (above grid) -->
					<div class="lg:hidden">
						<PartySidebar variant="mobile" />
						<GestureHint />
					</div>

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
