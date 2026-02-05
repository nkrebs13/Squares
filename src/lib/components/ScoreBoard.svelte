<script lang="ts">
	import { scores, liveScores, party } from '$lib/stores/game';
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

	// Live game detection
	const isLive = $derived(
		$liveScores?.status != null &&
			$liveScores.status !== 'pregame' &&
			$liveScores.status !== 'final'
	);
	const isFinal = $derived($liveScores?.status === 'final');

	// Big score display: live if available, else latest locked quarter
	const displayRowScore = $derived(
		isLive ? ($liveScores?.rowScore ?? 0) : (currentQuarter?.rowScore ?? 0)
	);
	const displayColScore = $derived(
		isLive ? ($liveScores?.colScore ?? 0) : (currentQuarter?.colScore ?? 0)
	);

	// Quarter/clock label for live display
	const quarterLabel = $derived.by(() => {
		if (!isLive) return currentQuarter?.label ?? '';
		const q = $liveScores?.quarter ?? 0;
		if ($liveScores?.status === 'halftime') return 'HALF';
		if (q === 0) return '';
		if (q > 4) return q === 5 ? 'OT' : `${q - 4}OT`;
		return `Q${q}`;
	});
</script>

<div class="card">
	<div class="scoreboard">
		<div class="score-team">
			<div class="score-name team-row-text">{$theme.rowName}</div>
			<div class="score-value team-row-text" aria-live="polite" aria-atomic="true">
				{displayRowScore}
			</div>
		</div>

		<div class="score-middle">
			{#if isLive}
				<div class="live-badge">
					<span class="live-dot"></span>
					<span class="live-label">{quarterLabel}</span>
				</div>
				{#if $liveScores?.clock}
					<div class="live-clock">{$liveScores.clock}</div>
				{/if}
			{:else if isFinal}
				<div class="final-badge">FINAL</div>
			{:else}
				<div class="text-2xl font-light opacity-50">vs</div>
			{/if}
		</div>

		<div class="score-team">
			<div class="score-name team-col-text">{$theme.colName}</div>
			<div class="score-value team-col-text" aria-live="polite" aria-atomic="true">
				{displayColScore}
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

<style>
	.score-middle {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		min-width: 4rem;
	}

	.live-badge {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.live-dot {
		width: 0.5rem;
		height: 0.5rem;
		border-radius: 50%;
		background: #ef4444;
		animation: pulse-dot 1.5s ease-in-out infinite;
	}

	.live-label {
		color: var(--text-primary);
	}

	.live-clock {
		font-size: 0.875rem;
		font-variant-numeric: tabular-nums;
		color: var(--text-secondary);
	}

	.final-badge {
		font-size: 0.75rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--text-secondary);
	}

	@keyframes pulse-dot {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.3;
		}
	}
</style>
