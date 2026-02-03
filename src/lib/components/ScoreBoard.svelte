<script lang="ts">
	import { scores, party } from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { isGameInProgress } from '$lib/types';
	import type { Quarter } from '$lib/types';

	interface QuarterScore {
		quarter: Quarter;
		label: string;
		rowScore: number | null;
		colScore: number | null;
	}

	const quarterScores = $derived<QuarterScore[]>([
		{
			quarter: 'q1',
			label: 'Q1',
			rowScore: $scores?.q1_row_score ?? null,
			colScore: $scores?.q1_col_score ?? null,
		},
		{
			quarter: 'q2',
			label: 'Q2',
			rowScore: $scores?.q2_row_score ?? null,
			colScore: $scores?.q2_col_score ?? null,
		},
		{
			quarter: 'q3',
			label: 'Q3',
			rowScore: $scores?.q3_row_score ?? null,
			colScore: $scores?.q3_col_score ?? null,
		},
		{
			quarter: 'final',
			label: 'Final',
			rowScore: $scores?.final_row_score ?? null,
			colScore: $scores?.final_col_score ?? null,
		},
	]);

	const currentQuarter = $derived.by<QuarterScore | null>(() => {
		if (!$scores) return null;
		if ($scores.final_row_score !== null) return quarterScores[3];
		if ($scores.q3_row_score !== null) return quarterScores[2];
		if ($scores.q2_row_score !== null) return quarterScores[1];
		if ($scores.q1_row_score !== null) return quarterScores[0];
		return null;
	});
</script>

<div class="card">
	<div class="scoreboard">
		<div class="score-team">
			<div class="score-name team-row-text">{$theme.rowName}</div>
			<div class="score-value team-row-text">
				{currentQuarter?.rowScore ?? 0}
			</div>
		</div>

		<div class="text-2xl font-light opacity-50">vs</div>

		<div class="score-team">
			<div class="score-name team-col-text">{$theme.colName}</div>
			<div class="score-value team-col-text">
				{currentQuarter?.colScore ?? 0}
			</div>
		</div>
	</div>

	{#if isGameInProgress($party?.status) || $party?.status === 'complete'}
		<div class="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
			{#each quarterScores as qs (qs.quarter)}
				<div class="quarter-score-box">
					<div class="font-medium" style="color: var(--text-secondary)">{qs.label}</div>
					<div class="font-mono">
						{qs.rowScore ?? '-'} - {qs.colScore ?? '-'}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</div>
