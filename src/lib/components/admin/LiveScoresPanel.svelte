<script lang="ts">
	import { liveScores } from '$lib/stores/game';
	import type { Party } from '$lib/types';
	import { formatQuarterLabel } from '$lib/utils/quarter';

	interface Props {
		party: Party;
		showManualOverride: boolean;
	}

	let { party, showManualOverride = $bindable() }: Props = $props();
</script>

<!-- API Integration Mode -->
<div
	class="card"
	style="border: 1px solid rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.08);"
	role="region"
	aria-label="Live game integration"
>
	{#if $liveScores?.status && $liveScores.status !== 'pregame'}
		<!-- Live scores display -->
		<div class="flex items-center justify-between">
			<p class="text-sm" style="color: rgb(147, 197, 253);" aria-live="polite">
				<span class="font-semibold">
					{party.team_row_name}
					{$liveScores.rowScore} - {party.team_col_name}
					{$liveScores.colScore}
				</span>
				{#if $liveScores.status === 'final'}
					<span class="ml-2" role="status">FINAL</span>
				{:else if $liveScores.status === 'halftime'}
					<span class="ml-2" role="status">HALFTIME</span>
				{:else if $liveScores.clock}
					<span class="ml-2" role="status">
						{$liveScores.clock} - {formatQuarterLabel($liveScores.quarter)}
					</span>
				{/if}
			</p>
		</div>
	{:else}
		<!-- Waiting/Pregame -->
		<p class="text-sm" style="color: rgb(147, 197, 253);">
			<span class="font-semibold">Live API connected</span>
			{#if $liveScores?.status === 'pregame'}
				<span class="ml-2">— Game has not started yet</span>
			{:else}
				<span class="ml-2">— Waiting for game data...</span>
			{/if}
		</p>
	{/if}

	<!-- Toggle always visible when API connected -->
	<button
		onclick={() => (showManualOverride = !showManualOverride)}
		class="text-xs mt-2"
		style="color: rgb(147, 197, 253); opacity: 0.7; background: none; border: none; cursor: pointer; padding: 0; text-decoration: underline;"
	>
		{showManualOverride ? 'Hide manual override' : 'Show manual override'}
	</button>
</div>
