<script lang="ts">
	import { party, filledCount, isGridFull } from '$lib/stores/game';
	import { isGameInProgress } from '$lib/types';
	import { buildPayoutRows, calculateTotalPot } from '$lib/payouts';
	import { formatKickoff } from '$lib/utils/datetime';
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
	const totalPot = $derived($party ? calculateTotalPot($party.square_price) : 0);
	const payoutRows = $derived(
		$party
			? buildPayoutRows(
					{
						q1: $party.split_q1,
						q2: $party.split_q2,
						q3: $party.split_q3,
						final: $party.split_final,
					},
					totalPot
				)
			: []
	);
</script>

{#if $party}
	{@const kickoff = formatKickoff($party.kickoff_at)}
	<div class="mb-4 card text-sm">
		{#if isDesktop}
			<h3 class="font-medium mb-2 text-secondary">Game</h3>
		{/if}
		<div class="font-semibold">{$party.event_name}</div>
		<div class="mt-1 text-secondary">{$party.team_row_name} vs {$party.team_col_name}</div>
		{#if kickoff}
			<div class="mt-1 text-muted">{kickoff}</div>
		{/if}
	</div>
{/if}

<!-- Status banner -->
{#if $party?.status === 'filling'}
	<div class="mb-4 status-banner status-banner-filling">
		<span class="font-medium">{$filledCount}/100</span> squares filled
		{#if $isGridFull}
			<span class="ml-2 text-success">• Ready to lock!</span>
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
			<h3 class="font-medium mb-3 text-secondary">Prize Split</h3>
		{/if}
		<div class="grid grid-cols-4 gap-2 text-center">
			{#each payoutRows as row (row.key)}
				<div data-testid={`party-payout-${row.key}`}>
					<div class="text-muted">{row.label}</div>
					<div class="font-medium">{row.percent}%</div>
					{#if $party.square_price > 0}
						<div class="text-xs text-secondary">{formatPrice(row.amount)}</div>
					{/if}
				</div>
			{/each}
		</div>
		{#if $party.square_price > 0}
			<div class="mt-3 text-center text-secondary">
				{formatPrice($party.square_price)}/square • {formatPrice(totalPot)} total pot
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
