<script lang="ts">
	import { isFilling, hasDrawnNumbers } from '$lib/partyStatus';
	import { MediaQuery } from 'svelte/reactivity';
	import { DESKTOP_LAYOUT_QUERY } from '$lib/layout';
	import { party, filledCount, isGridFull } from '$lib/stores/game';

	import { buildPayoutRows, calculateTotalPot, partySplits } from '$lib/payouts';
	import { TOTAL_SQUARES } from '$lib/constants';
	import { formatKickoff } from '$lib/utils/datetime';
	import { formatMatchup, formatPrice } from '$lib/utils/format';
	import ScoreBoard from './ScoreBoard.svelte';
	import Winners from './Winners.svelte';
	import PlayerStats from './PlayerStats.svelte';
	import PartyCode from './PartyCode.svelte';
	import PushOptIn from './PushOptIn.svelte';
	import PlayerLegend from './PlayerLegend.svelte';

	// Above the grid on mobile; a titled column with the player legend on desktop.
	const desktop = new MediaQuery(DESKTOP_LAYOUT_QUERY);
	const totalPot = $derived($party ? calculateTotalPot($party.square_price) : 0);
	const payoutRows = $derived($party ? buildPayoutRows(partySplits($party), totalPot) : []);
</script>

{#if $party}
	{@const kickoff = formatKickoff($party.kickoff_at)}
	<div class="mb-4 card text-sm">
		{#if desktop.current}
			<h3 class="font-medium mb-2 text-secondary">Game</h3>
		{/if}
		<div class="font-semibold">{$party.event_name}</div>
		<div class="mt-1 text-secondary">
			{formatMatchup($party.team_row_name, $party.team_col_name)}
		</div>
		{#if kickoff}
			<div class="mt-1 text-muted">{kickoff}</div>
		{/if}
	</div>
{/if}

{#if isFilling($party?.status)}
	<div class="mb-4 status-banner status-banner-filling">
		<span class="font-medium">{$filledCount}/{TOTAL_SQUARES}</span> squares filled
		{#if $isGridFull}
			<span class="ml-2 text-success">• Ready to lock!</span>
		{/if}
	</div>
{:else if hasDrawnNumbers($party?.status)}
	<div class="mb-4">
		<ScoreBoard />
	</div>
{/if}

{#if hasDrawnNumbers($party?.status)}
	<div class="mb-4">
		<Winners />
	</div>
{/if}

<div class="mb-4">
	<PlayerStats />
</div>

<div class="mb-4">
	<PartyCode />
</div>

<div class="mb-4">
	<PushOptIn />
</div>

{#if $party}
	<div class="card text-sm">
		{#if desktop.current}
			<h3 class="font-medium mb-3 text-secondary">Prize Split</h3>
		{/if}
		<div class="grid grid-cols-4 gap-2 text-center">
			{#each payoutRows as row (row.key)}
				<div data-testid={`party-payout-${row.key}`}>
					<div class="text-muted">{row.label}</div>
					<div class="font-medium">{row.percent}%</div>
					<div class="text-xs text-secondary">{formatPrice(row.amount)}</div>
				</div>
			{/each}
		</div>
		<div class="mt-3 text-center text-secondary">
			{formatPrice($party.square_price)}/square • {formatPrice(totalPot)} total pot
		</div>
	</div>
{/if}

{#if desktop.current}
	<div class="mt-4">
		<PlayerLegend />
	</div>
{/if}
