<script lang="ts">
	import { winners, party, scores } from '$lib/stores/game';
	import type { Quarter } from '$lib/types';
	import { quarterIndex, quarterInfo, quarterScore } from '$lib/quarters';
	import { formatPrice } from '$lib/utils/format';

	const sortedWinners = $derived(
		[...$winners].sort((a, b) => quarterIndex(a.quarter) - quarterIndex(b.quarter))
	);

	function getScoreForQuarter(quarter: Quarter): string {
		if (!$party) return '';
		const { row, col } = quarterScore($scores, quarter);
		if (row === null || col === null) return '';
		return `${$party.team_row_name} ${row} - ${$party.team_col_name} ${col}`;
	}
</script>

{#if $winners.length > 0}
	<div class="space-y-3">
		<h3 class="text-lg font-semibold">Winners</h3>
		{#each sortedWinners as winner (winner.id)}
			<div class="winner-banner animate-fade-in">
				<div class="flex justify-between items-center">
					<div>
						<div class="text-sm text-secondary">
							{quarterInfo(winner.quarter).long}
						</div>
						<div class="text-lg font-bold">{winner.player_name}</div>
					</div>
					<div class="text-right">
						<div class="text-sm text-secondary">Won</div>
						<div class="text-lg font-bold" style="color: var(--color-success)">
							{formatPrice(winner.amount)}
						</div>
					</div>
				</div>
				<div class="mt-2 text-xs text-muted">
					{getScoreForQuarter(winner.quarter)}
				</div>
			</div>
		{/each}
	</div>
{:else if $party?.status === 'complete'}
	<!-- Game over but no winners — usually means scores haven't been entered yet
	     or every score landed on a square that wasn't claimed. -->
	<div class="space-y-3">
		<h3 class="text-lg font-semibold">Winners</h3>
		<div class="card text-sm text-secondary">
			No winners assigned yet — waiting on quarter scores. Once the host enters scores in the admin
			panel, winners will appear here.
		</div>
	</div>
{/if}
