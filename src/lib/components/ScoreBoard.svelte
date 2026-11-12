<script lang="ts">
	import { scores, liveScores, teamTheme } from '$lib/stores/game';
	import type { Quarter } from '$lib/types';
	import { isGameFinal, isGameLive, isGameStarted, isHalftime } from '$lib/liveGame';
	import { QUARTERS, formatGamePeriod, latestScoredQuarter, quarterScore } from '$lib/quarters';

	interface QuarterScore {
		quarter: Quarter;
		label: string;
		rowScore: number | null;
		colScore: number | null;
	}

	const quarterScores = $derived<QuarterScore[]>(
		QUARTERS.map(({ key, short }) => {
			const { row, col } = quarterScore($scores, key);
			return { quarter: key, label: short, rowScore: row, colScore: col };
		})
	);

	const currentQuarter = $derived.by<QuarterScore | null>(() => {
		const latest = latestScoredQuarter($scores);
		return latest ? (quarterScores.find((q) => q.quarter === latest) ?? null) : null;
	});

	const isLive = $derived(isGameLive($liveScores?.status));
	const isFinal = $derived(isGameFinal($liveScores?.status));
	// From kickoff to the final whistle the board shows the game's own score, so a
	// FINAL badge never sits beside the party's last recorded quarter.
	const followsGame = $derived(isGameStarted($liveScores?.status));

	const displayRowScore = $derived(
		followsGame ? ($liveScores?.rowScore ?? 0) : (currentQuarter?.rowScore ?? 0)
	);
	const displayColScore = $derived(
		followsGame ? ($liveScores?.colScore ?? 0) : (currentQuarter?.colScore ?? 0)
	);

	const quarterLabel = $derived.by(() => {
		if (!isLive) return currentQuarter?.label ?? '';
		const q = $liveScores?.quarter ?? 0;
		if (isHalftime($liveScores?.status)) return 'HALF';
		return formatGamePeriod(q);
	});
</script>

<div class="card">
	<div class="scoreboard">
		<div class="score-team">
			<div class="score-name team-row-text">{$teamTheme.rowName}</div>
			<div class="score-value team-row-text" aria-live="polite" aria-atomic="true">
				{displayRowScore}
			</div>
		</div>

		<div class="score-middle">
			{#if isLive}
				<div class="live-badge" role="status" aria-label="Live game: {quarterLabel}">
					<span class="live-dot" aria-hidden="true"></span>
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
			<div class="score-name team-col-text">{$teamTheme.colName}</div>
			<div class="score-value team-col-text" aria-live="polite" aria-atomic="true">
				{displayColScore}
			</div>
		</div>
	</div>

	<div class="mt-4 grid grid-cols-4 gap-2 text-center text-xs">
		{#each quarterScores as qs (qs.quarter)}
			<div class="quarter-score-box">
				<div class="font-medium text-secondary">{qs.label}</div>
				<div class="font-mono">
					{qs.rowScore ?? '-'} - {qs.colScore ?? '-'}
				</div>
			</div>
		{/each}
	</div>
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
		background: rgb(var(--rgb-error));
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
