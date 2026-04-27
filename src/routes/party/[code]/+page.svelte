<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import SimpleGrid from '$lib/components/SimpleGrid.svelte';
	import ScoreBoard from '$lib/components/ScoreBoard.svelte';
	import Winners from '$lib/components/Winners.svelte';
	import PartyCode from '$lib/components/PartyCode.svelte';
	import PlayerStats from '$lib/components/PlayerStats.svelte';
	import PlayerLegend from '$lib/components/PlayerLegend.svelte';
	import GridSkeleton from '$lib/components/GridSkeleton.svelte';
	import GestureHint from '$lib/components/GestureHint.svelte';
	import PushOptIn from '$lib/components/PushOptIn.svelte';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import {
		loadParty,
		subscribeToParty,
		cleanup,
		party,
		isLoading,
		error,
		filledCount,
		isGridFull,
	} from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import { saveRecentParty, hasHostPin } from '$lib/storage';
	import { formatPrice } from '$lib/utils/format';
	import { isGameInProgress } from '$lib/types';
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
	<ConnectionBanner />
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
					<!-- Status banner (mobile + desktop inline) -->
					{#if $party.status === 'filling'}
						<div class="mb-4 status-banner status-banner-filling lg:hidden">
							<span class="font-medium">{$filledCount}/100</span> squares filled
							{#if $isGridFull}
								<span class="ml-2" style="color: var(--color-success)">• Ready to lock!</span>
							{/if}
						</div>
					{:else if isGameInProgress($party.status) || $party.status === 'complete'}
						<div class="mb-4 lg:hidden">
							<ScoreBoard />
						</div>
					{/if}

					<!-- Winners (mobile only) -->
					{#if isGameInProgress($party.status) || $party.status === 'complete'}
						<div class="mb-4 lg:hidden">
							<Winners />
						</div>
					{/if}

					<!-- Gesture hint for first-time mobile visitors -->
					<div class="lg:hidden">
						<GestureHint />
					</div>

					<!-- Main Grid -->
					<div class="mb-4 lg:mb-0">
						<SimpleGrid />
					</div>

					<!-- Mobile-only sections below grid -->
					<div class="lg:hidden">
						<!-- Player Stats -->
						<div class="mb-4">
							<PlayerStats />
						</div>

						<!-- Party Code (for sharing) -->
						<div class="mb-4">
							<PartyCode />
						</div>

						<!-- Push notification opt-in -->
						<div class="mb-4">
							<PushOptIn />
						</div>

						<!-- Prize info -->
						<div class="card text-sm">
							<div class="grid grid-cols-4 gap-2 text-center">
								<div>
									<div style="color: var(--text-muted)">Q1</div>
									<div class="font-medium">{$party.split_q1}%</div>
								</div>
								<div>
									<div style="color: var(--text-muted)">Q2</div>
									<div class="font-medium">{$party.split_q2}%</div>
								</div>
								<div>
									<div style="color: var(--text-muted)">Q3</div>
									<div class="font-medium">{$party.split_q3}%</div>
								</div>
								<div>
									<div style="color: var(--text-muted)">Final</div>
									<div class="font-medium">{$party.split_final}%</div>
								</div>
							</div>
							{#if $party.square_price > 0}
								<div class="mt-3 text-center" style="color: var(--text-secondary)">
									{formatPrice($party.square_price)}/square • {formatPrice(
										$party.square_price * 100
									)} total pot
								</div>
							{/if}
						</div>
					</div>
				</div>
				{#snippet failed(_error, reset)}
					<div class="card" style="border: 1px solid rgba(239, 68, 68, 0.3);">
						<p class="text-sm" style="color: #f87171;">This section encountered an error.</p>
						<div class="flex gap-2 mt-2">
							<button class="btn btn-secondary btn-sm" type="button" onclick={reset}
								>Try again</button
							>
							<button
								class="btn btn-secondary btn-sm"
								type="button"
								onclick={() => window.location.reload()}>Reload</button
							>
						</div>
					</div>
				{/snippet}
			</svelte:boundary>

			<!-- Desktop Sidebar -->
			<svelte:boundary>
				<aside class="sidebar hidden lg:block">
					<div>
						<!-- Status banner -->
						{#if $party.status === 'filling'}
							<div class="mb-4 status-banner status-banner-filling">
								<span class="font-medium">{$filledCount}/100</span> squares filled
								{#if $isGridFull}
									<span class="ml-2" style="color: var(--color-success)">• Ready to lock!</span>
								{/if}
							</div>
						{:else if isGameInProgress($party.status) || $party.status === 'complete'}
							<div class="mb-4">
								<ScoreBoard />
							</div>
						{/if}

						<!-- Winners -->
						{#if isGameInProgress($party.status) || $party.status === 'complete'}
							<div class="mb-4">
								<Winners />
							</div>
						{/if}

						<!-- Player Stats -->
						<div class="mb-4">
							<PlayerStats />
						</div>

						<!-- Party Code (for sharing) -->
						<div class="mb-4">
							<PartyCode />
						</div>

						<!-- Push notification opt-in -->
						<div class="mb-4">
							<PushOptIn />
						</div>

						<!-- Prize info -->
						<div class="card text-sm">
							<h3 class="font-medium mb-3" style="color: var(--text-secondary)">Prize Split</h3>
							<div class="grid grid-cols-4 gap-2 text-center">
								<div>
									<div style="color: var(--text-muted)">Q1</div>
									<div class="font-medium">{$party.split_q1}%</div>
								</div>
								<div>
									<div style="color: var(--text-muted)">Q2</div>
									<div class="font-medium">{$party.split_q2}%</div>
								</div>
								<div>
									<div style="color: var(--text-muted)">Q3</div>
									<div class="font-medium">{$party.split_q3}%</div>
								</div>
								<div>
									<div style="color: var(--text-muted)">Final</div>
									<div class="font-medium">{$party.split_final}%</div>
								</div>
							</div>
							{#if $party.square_price > 0}
								<div class="mt-3 text-center" style="color: var(--text-secondary)">
									{formatPrice($party.square_price)}/square • {formatPrice(
										$party.square_price * 100
									)} total pot
								</div>
							{/if}
						</div>

						<!-- Player Legend -->
						<div class="mt-4">
							<PlayerLegend />
						</div>
					</div>
				</aside>
				{#snippet failed(_error, reset)}
					<aside class="sidebar hidden lg:block">
						<div class="card" style="border: 1px solid rgba(239, 68, 68, 0.3);">
							<p class="text-sm" style="color: #f87171;">This section encountered an error.</p>
							<div class="flex gap-2 mt-2">
								<button class="btn btn-secondary btn-sm" type="button" onclick={reset}
									>Try again</button
								>
								<button
									class="btn btn-secondary btn-sm"
									type="button"
									onclick={() => window.location.reload()}>Reload</button
								>
							</div>
						</div>
					</aside>
				{/snippet}
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
