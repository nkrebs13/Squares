<script lang="ts">
	import { get } from 'svelte/store';
	import { broadcastScoreUpdate, loadParty, scores, updateScore } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import { isGameInProgress, type Party, type Quarter, type Scores } from '$lib/types';
	import { deriveNextQuarter, scoresForQuarter } from '$lib/utils/quarter';

	interface Props {
		party: Party;
		code: string;
		storedPin: string;
		description: string;
		/**
		 * Whether the form is rendered. The component stays mounted either way so the
		 * host's in-progress entry survives hiding/showing the manual override.
		 */
		visible?: boolean;
	}

	const { party, code, storedPin, description, visible = true }: Props = $props();

	const quarters: { value: Quarter; label: string }[] = [
		{ value: 'q1', label: '1st Quarter' },
		{ value: 'q2', label: '2nd Quarter' },
		{ value: 'q3', label: '3rd Quarter' },
		{ value: 'final', label: 'Final' },
	];

	const manualScores = $state({
		quarter: 'q1' as Quarter,
		rowScore: 0,
		colScore: 0,
	});
	let isUpdatingScore = $state(false);

	const nextQuarter = $derived.by(() => deriveNextQuarter($scores));

	function syncManualScoreFields(s: Scores | null, quarter: Quarter) {
		const currentScores = scoresForQuarter(s, quarter);
		manualScores.rowScore = currentScores.row;
		manualScores.colScore = currentScores.col;
	}

	// The quarter select's own change handler — a direct user action, so it's
	// fine to resync row/col fields to the newly-selected quarter's committed
	// values here.
	function handleQuarterSelected() {
		syncManualScoreFields($scores, manualScores.quarter);
	}

	// Initialize the quarter selector (to the next quarter needing entry) and
	// its row/col fields ONCE, from the current scores snapshot. `scores` is
	// replaced wholesale on every postgres UPDATE of the scores row —
	// including the game_scores_live_propagate trigger's live-tick updates
	// (migration 017:199-219) — so re-running this on every `$scores` change
	// would silently overwrite the host's in-progress manual override
	// (destroying the exact feature this form exists for). Initialize once,
	// never clobber unsaved work after that.
	let manualScoreEntryInitialized = $state(false);
	$effect(() => {
		if (!manualScoreEntryInitialized && isGameInProgress(party.status) && $scores) {
			manualScores.quarter = nextQuarter;
			syncManualScoreFields($scores, nextQuarter);
			manualScoreEntryInitialized = true;
		}
	});

	async function handleUpdateScore() {
		isUpdatingScore = true;

		const result = await updateScore(
			storedPin,
			manualScores.quarter,
			manualScores.rowScore,
			manualScores.colScore
		);

		if (result.success) {
			toast.success(
				`Score updated for ${manualScores.quarter === 'final' ? 'Final' : `Q${manualScores.quarter.slice(1)}`}!`
			);
			broadcastScoreUpdate();
			await loadParty(code);
			// Auto-advance to the next unscored quarter after a discrete, successful
			// save. WITHOUT this, the selector stays on the just-saved quarter and the
			// host's next submit silently overwrites it (recomputing that quarter's
			// winner — real money). This advances ONLY on an explicit save, so it does
			// NOT reintroduce the $scores live-tick clobber that
			// manualScoreEntryInitialized guards against.
			//
			// Compute directly from the freshly-reloaded get(scores) snapshot rather
			// than reading the $derived nextQuarter: across the await boundary the
			// store is guaranteed current via get(), whereas the runes-batched
			// $scores binding (and any derived over it) may not have flushed yet.
			const reloadedScores = get(scores);
			const next = deriveNextQuarter(reloadedScores);
			manualScores.quarter = next;
			syncManualScoreFields(reloadedScores, next);
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
					onchange={handleQuarterSelected}
				>
					{#each quarters as q (q.value)}
						<option value={q.value}>{q.label}</option>
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
