<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Grid from '$lib/components/Grid.svelte';
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

<div class="min-h-screen p-4 pb-24">
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

		<!-- Main Grid -->
		<div class="mb-4">
			<Grid />
		</div>

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
	{/if}
</div>
