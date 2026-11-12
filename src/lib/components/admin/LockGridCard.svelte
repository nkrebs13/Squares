<script lang="ts">
	import { filledCount, isGridFull, lockParty } from '$lib/stores/game';
	import { TOTAL_SQUARES } from '$lib/constants';
	import { toast } from '$lib/stores/toast';

	interface Props {
		storedPin: string;
	}

	const { storedPin }: Props = $props();

	let isLocking = $state(false);

	async function handleLockGrid() {
		if (!$isGridFull) return;

		isLocking = true;

		const result = await lockParty(storedPin);

		if (result.success) {
			toast.success(
				'Game started! Numbers have been assigned. Enter scores below as each quarter ends.'
			);
		} else {
			toast.error(result.error || 'Failed to lock grid');
		}
		isLocking = false;
	}
</script>

<div class="card">
	<h2 class="text-lg font-semibold mb-4">Start Game</h2>
	{#if $isGridFull}
		<p class="text-sm mb-4 text-secondary">
			All {TOTAL_SQUARES} squares are filled. Lock the grid, assign random numbers, and start the game.
		</p>
		<button onclick={handleLockGrid} class="btn btn-success w-full" disabled={isLocking}>
			{isLocking ? 'Starting...' : 'Lock Grid & Start Game'}
		</button>
	{:else}
		<p class="text-sm text-secondary">
			Grid is not full yet ({$filledCount}/{TOTAL_SQUARES}). Wait for all squares to be claimed
			before starting.
		</p>
		<div class="mt-4 progress-bar">
			<div class="progress-bar-fill" style="width: {($filledCount / TOTAL_SQUARES) * 100}%"></div>
		</div>
	{/if}
</div>
