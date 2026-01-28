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
	import {
		loadParty,
		subscribeToParty,
		cleanup,
		party,
		isLoading,
		error,
		filledCount,
		isGridFull
	} from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import { saveRecentParty, hasHostPin } from '$lib/storage';
	import type { RecentParty } from '$lib/types';

	let code = $derived($page.params.code ?? '');
	let unsubscribe: (() => void) | null = null;

	// Check if user is host (has PIN stored)
	let isHost = $state(false);

	// Collapsible sidebar state
	let sidebarCollapsed = $state(false);

	async function checkIsHost() {
		if (browser && code) {
			// Check IndexedDB first, then fallback to sessionStorage
			isHost = await hasHostPin(code) || sessionStorage.getItem(`squares_pin_${code}`) !== null;
		}
	}

	async function saveToRecentParties() {
		if (!$party) return;

		const recentParty: RecentParty = {
			code: $party.code,
			teamRowName: $party.team_row_name,
			teamColName: $party.team_col_name,
			lastVisited: Date.now(),
			status: $party.status,
			isHost
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
			unsubscribe = subscribeToParty($party.id);
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

<div class="party-page">
	{#if $isLoading}
		<div class="flex items-center justify-center h-screen">
			<div class="text-center">
				<div class="w-12 h-12 border-4 rounded-full animate-spin mx-auto" style="border-color: rgba(100, 210, 200, 0.3); border-top-color: rgba(100, 210, 200, 0.8);"></div>
				<p class="mt-4" style="color: var(--text-secondary)">Loading party...</p>
			</div>
		</div>
	{:else if $error}
		<div class="flex flex-col items-center justify-center h-screen gap-4">
			<p style="color: #fca5a5">{$error}</p>
			<a href="/" class="btn btn-secondary">Go Home</a>
		</div>
	{:else if $party}
		<header class="mb-4 flex justify-between items-start">
			<div>
				<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Home</a>
				<h1 class="text-2xl font-bold mt-1">
					{$party.team_row_name} vs {$party.team_col_name}
				</h1>
			</div>
			{#if isHost}
				<a
					href="/party/{code}/admin"
					class="btn btn-secondary text-sm"
				>
					Host Panel
				</a>
			{/if}
		</header>

		<!-- Desktop Two-Column Layout -->
		<div class="desktop-layout">
			<!-- Main Content (Grid) -->
			<div class="main-content">
				<!-- Status banner (mobile + desktop inline) -->
				{#if $party.status === 'filling'}
					<div class="mb-4 status-banner status-banner-filling lg:hidden">
						<span class="font-medium">{$filledCount}/100</span> squares filled
						{#if $isGridFull}
							<span class="ml-2" style="color: var(--color-success)">• Ready to lock!</span>
						{/if}
					</div>
				{:else if $party.status === 'locked'}
					<div class="mb-4 status-banner status-banner-locked lg:hidden">
						Grid locked — waiting for game to start
					</div>
				{:else if $party.status === 'active'}
					<div class="mb-4 lg:hidden">
						<ScoreBoard />
					</div>
				{:else if $party.status === 'complete'}
					<div class="mb-4 status-banner status-banner-success lg:hidden">
						Game complete!
					</div>
				{/if}

				<!-- Winners (mobile only) -->
				{#if ($party.status === 'active' || $party.status === 'complete')}
					<div class="mb-4 lg:hidden">
						<Winners />
					</div>
				{/if}

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
					{#if $party.status === 'filling'}
						<div class="mb-4">
							<PartyCode />
						</div>
					{/if}

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
								${$party.square_price}/square • ${($party.square_price * 100).toFixed(0)} total pot
							</div>
						{/if}
					</div>
				</div>
			</div>

			<!-- Desktop Sidebar -->
			<aside class="sidebar hidden lg:block {sidebarCollapsed ? 'collapsed' : ''}">
				<!-- Sidebar collapse toggle -->
				<button
					class="sidebar-toggle"
					onclick={() => sidebarCollapsed = !sidebarCollapsed}
					aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						class="chevron-icon {sidebarCollapsed ? 'collapsed' : ''}"
					>
						<polyline points="9 18 15 12 9 6"></polyline>
					</svg>
				</button>
				<div class="sidebar-content">
					<!-- Status banner -->
					{#if $party.status === 'filling'}
						<div class="mb-4 status-banner status-banner-filling">
							<span class="font-medium">{$filledCount}/100</span> squares filled
							{#if $isGridFull}
								<span class="ml-2" style="color: var(--color-success)">• Ready to lock!</span>
							{/if}
						</div>
					{:else if $party.status === 'locked'}
						<div class="mb-4 status-banner status-banner-locked">
							Grid locked — waiting for game to start
						</div>
					{:else if $party.status === 'active'}
						<div class="mb-4">
							<ScoreBoard />
						</div>
					{:else if $party.status === 'complete'}
						<div class="mb-4 status-banner status-banner-success">
							Game complete!
						</div>
					{/if}

					<!-- Winners -->
					{#if $party.status === 'active' || $party.status === 'complete'}
						<div class="mb-4">
							<Winners />
						</div>
					{/if}

					<!-- Player Stats -->
					<div class="mb-4">
						<PlayerStats />
					</div>

					<!-- Party Code (for sharing) -->
					{#if $party.status === 'filling'}
						<div class="mb-4">
							<PartyCode />
						</div>
					{/if}

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
								${$party.square_price}/square • ${($party.square_price * 100).toFixed(0)} total pot
							</div>
						{/if}
					</div>
				</div>
			</aside>
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
		.main-content > div:has(.grid-wrapper) {
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
			position: relative;
			width: 340px;
			max-width: 400px;
			flex-shrink: 0;
			transition: width 200ms ease, opacity 200ms ease;
		}

		.sidebar.collapsed {
			width: 0;
			opacity: 0;
			overflow: hidden;
		}

		.sidebar-toggle {
			position: absolute;
			left: -12px;
			top: 1rem;
			width: 24px;
			height: 24px;
			display: flex;
			align-items: center;
			justify-content: center;
			background: var(--bg-secondary);
			border: 1px solid var(--border-color);
			border-radius: 50%;
			color: var(--text-secondary);
			cursor: pointer;
			z-index: 10;
			transition: all 200ms ease;
		}

		.sidebar-toggle:hover {
			background: rgba(255, 255, 255, 0.08);
			color: var(--text-primary);
		}

		.sidebar.collapsed .sidebar-toggle {
			left: -36px;
		}

		.chevron-icon {
			transition: transform 200ms ease;
		}

		.chevron-icon.collapsed {
			transform: rotate(180deg);
		}

		.sidebar-content {
			position: sticky;
			top: 1rem;
			max-height: calc(100vh - 2rem);
			overflow-y: auto;
			padding-right: 0.5rem;
		}

		/* Custom scrollbar for sidebar */
		.sidebar-content::-webkit-scrollbar {
			width: 4px;
		}

		.sidebar-content::-webkit-scrollbar-track {
			background: transparent;
		}

		.sidebar-content::-webkit-scrollbar-thumb {
			background: rgba(255, 255, 255, 0.1);
			border-radius: 2px;
		}

		.sidebar-content::-webkit-scrollbar-thumb:hover {
			background: rgba(255, 255, 255, 0.2);
		}
	}

	/* Larger desktop - wider sidebar */
	@media (min-width: 1280px) {
		.sidebar:not(.collapsed) {
			width: 380px;
		}
	}
</style>
