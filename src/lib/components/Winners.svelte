<script lang="ts">
	import { winners, party, scores } from '$lib/stores/game';
	import type { Quarter } from '$lib/types';

	const quarterLabels: Record<Quarter, string> = {
		q1: '1st Quarter',
		q2: '2nd Quarter',
		q3: '3rd Quarter',
		final: 'Final'
	};

	function formatAmount(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD'
		}).format(amount);
	}

	function getScoreForQuarter(quarter: Quarter): string {
		if (!$scores || !$party) return '';
		const teamRow = $party.team_row_name;
		const teamCol = $party.team_col_name;

		let rowScore: number | null = null;
		let colScore: number | null = null;

		switch (quarter) {
			case 'q1':
				rowScore = $scores.q1_row_score;
				colScore = $scores.q1_col_score;
				break;
			case 'q2':
				rowScore = $scores.q2_row_score;
				colScore = $scores.q2_col_score;
				break;
			case 'q3':
				rowScore = $scores.q3_row_score;
				colScore = $scores.q3_col_score;
				break;
			case 'final':
				rowScore = $scores.final_row_score;
				colScore = $scores.final_col_score;
				break;
		}

		if (rowScore === null || colScore === null) return '';
		return `${teamRow} ${rowScore} - ${teamCol} ${colScore}`;
	}
</script>

{#if $winners.length > 0}
	<div class="space-y-3">
		<h3 class="text-lg font-semibold">Winners</h3>
		{#each $winners as winner}
			<div class="winner-banner animate-fade-in">
				<div class="flex justify-between items-center">
					<div>
						<div class="text-sm" style="color: var(--text-secondary)">{quarterLabels[winner.quarter]}</div>
						<div class="text-lg font-bold">{winner.player_name}</div>
					</div>
					<div class="text-right">
						<div class="text-sm" style="color: var(--text-secondary)">Won</div>
						<div class="text-lg font-bold" style="color: var(--color-success)">{formatAmount(winner.amount)}</div>
					</div>
				</div>
				<div class="mt-2 text-xs" style="color: var(--text-muted)">
					{getScoreForQuarter(winner.quarter)}
				</div>
			</div>
		{/each}
	</div>
{/if}
