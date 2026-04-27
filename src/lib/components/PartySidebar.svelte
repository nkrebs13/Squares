<script lang="ts">
	import { party, filledCount, isGridFull } from '$lib/stores/game';
	import { isGameInProgress } from '$lib/types';
	import { formatPrice } from '$lib/utils/format';
	import ScoreBoard from './ScoreBoard.svelte';
	import Winners from './Winners.svelte';
	import PlayerStats from './PlayerStats.svelte';
	import PartyCode from './PartyCode.svelte';
	import PushOptIn from './PushOptIn.svelte';
	import PlayerLegend from './PlayerLegend.svelte';

	interface Props {
		variant: 'mobile' | 'desktop';
	}

	const { variant }: Props = $props();
	const isDesktop = $derived(variant === 'desktop');
</script>

<!-- Status banner -->
{#if $party?.status === 'filling'}
	<div class="mb-4 status-banner status-banner-filling">
		<span class="font-medium">{$filledCount}/100</span> squares filled
		{#if $isGridFull}
			<span class="ml-2" style="color: var(--color-success)">• Ready to lock!</span>
		{/if}
	</div>
{:else if isGameInProgress($party?.status) || $party?.status === 'complete'}
	<div class="mb-4">
		<ScoreBoard />
	</div>
{/if}

<!-- Winners -->
{#if isGameInProgress($party?.status) || $party?.status === 'complete'}
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
{#if $party}
	<div class="card text-sm">
		{#if isDesktop}
			<h3 class="font-medium mb-3" style="color: var(--text-secondary)">Prize Split</h3>
		{/if}
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
				{formatPrice($party.square_price)}/square • {formatPrice($party.square_price * 100)} total pot
			</div>
		{/if}
	</div>
{/if}

<!-- Player Legend (desktop only) -->
{#if isDesktop}
	<div class="mt-4">
		<PlayerLegend />
	</div>
{/if}
