<script lang="ts">
	import { get } from 'svelte/store';
	import { scores, updateScore } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import type { Party, Quarter, Scores } from '$lib/types';
	import { isGameInProgress } from '$lib/partyStatus';
	import { QUARTERS, nextQuarterToScore, quarterInfo, quarterScore } from '$lib/quarters';

	interface Props {
		party: Party;
		storedPin: string;
		description: string;
		/**
		 * Whether the form is rendered. The component stays mounted either way so the
		 * host's in-progress entry survives hiding/showing the manual override.
		 */
		visible?: boolean;
	}

	const { party, storedPin, description, visible = true }: Props = $props();

	const manualScores = $state({
		quarter: 'q1' as Quarter,
		rowScore: 0,
		colScore: 0,
	});
	let isUpdatingScore = $state(false);

	const nextQuarter = $derived.by(() => nextQuarterToScore($scores));

	function syncManualScoreFields(s: Scores | null, quarter: Quarter) {
		const { row, col } = quarterScore(s, quarter);
		manualScores.rowScore = row ?? 0;
		manualScores.colScore = col ?? 0;
	}

	// The form follows the scores (next quarter to enter, its committed values) until the
	// host edits it, then never overwrites their work. `scores` is replaced on every
	// postgres UPDATE, including live-game ticks, so following it unconditionally would
	// clobber an in-progress override; initialising only once instead left a hidden form
	// (linked game, override closed) showing a stale quarter that a later save would
	// rewrite with the wrong score.
	let edited = $state(false);
	$effect(() => {
		if (!edited && isGameInProgress(party.status) && $scores) {
			manualScores.quarter = nextQuarter;
			syncManualScoreFields($scores, nextQuarter);
		}
	});

	// A direct user choice: show that quarter's committed values and stop following.
	function handleQuarterSelected() {
		edited = true;
		syncManualScoreFields($scores, manualScores.quarter);
	}

	async function handleUpdateScore() {
		isUpdatingScore = true;

		const result = await updateScore(
			storedPin,
			manualScores.quarter,
			manualScores.rowScore,
			manualScores.colScore
		);

		if (result.success) {
			toast.success(`Score updated for ${quarterInfo(manualScores.quarter).short}!`);
			// Auto-advance to the next unscored quarter after a discrete, successful
			// save. WITHOUT this, the selector stays on the just-saved quarter and the
			// host's next submit silently overwrites it (recomputing that quarter's
			// winner — real money). This advances ONLY on an explicit save, so it does
			// NOT reintroduce the $scores live-tick clobber that
			// the `edited` flag guards against.
			//
			// updateScore has just set the store; read it with get() because the
			// runes-batched $scores binding may not have flushed yet.
			const reloadedScores = get(scores);
			const next = nextQuarterToScore(reloadedScores);
			manualScores.quarter = next;
			syncManualScoreFields(reloadedScores, next);
			// Saved: nothing unsaved is left, so the form follows the scores again.
			edited = false;
		} else {
			toast.error(result.error || 'Failed to update score');
		}

		isUpdatingScore = false;
	}
</script>

{#if visible}
	<div class="card">
		<h2 class="text-lg font-semibold mb-4">Manual Score Entry</h2>
		<p class="text-sm mb-4 text-secondary">
			{description}
		</p>

		<div class="space-y-4">
			<div>
				<label for="quarter-select" class="text-sm text-secondary">Quarter</label>
				<select
					id="quarter-select"
					bind:value={manualScores.quarter}
					class="input mt-1"
					disabled={isUpdatingScore}
					onchange={handleQuarterSelected}
				>
					{#each QUARTERS as q (q.key)}
						<option value={q.key}>{q.long}</option>
					{/each}
				</select>
			</div>

			<div class="grid grid-cols-2 gap-4">
				<div>
					<label for="row-score" class="text-sm text-secondary">{party.team_row_name}</label>
					<input
						id="row-score"
						type="number"
						bind:value={manualScores.rowScore}
						oninput={() => (edited = true)}
						disabled={isUpdatingScore}
						min="0"
						class="input input-no-spinner mt-1"
					/>
				</div>
				<div>
					<label for="col-score" class="text-sm text-secondary">{party.team_col_name}</label>
					<input
						id="col-score"
						type="number"
						bind:value={manualScores.colScore}
						oninput={() => (edited = true)}
						disabled={isUpdatingScore}
						min="0"
						class="input input-no-spinner mt-1"
					/>
				</div>
			</div>

			<button onclick={handleUpdateScore} class="btn btn-primary w-full" disabled={isUpdatingScore}>
				{isUpdatingScore ? 'Updating...' : 'Update Score & Calculate Winner'}
			</button>
		</div>
	</div>
{/if}
