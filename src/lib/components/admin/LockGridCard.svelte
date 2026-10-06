<script lang="ts">
	import { filledCount, isGridFull, loadParty, lockParty } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';

	interface Props {
		code: string;
		storedPin: string;
	}

	const { code, storedPin }: Props = $props();

	let isLocking = $state(false);

	async function handleLockGrid() {
		if (!$isGridFull) return;

		isLocking = true;

		const result = await lockParty(storedPin);

		if (result.success) {
			// Reload party data so the page reactively shows score entry controls
			try {
				await loadParty(code);
				toast.success(
					'Game started! Numbers have been assigned. Enter scores below as each quarter ends.'
				);
			} catch {
				toast.error(
					'Game started, but failed to reload the latest game data. Please refresh the page.'
				);
			}
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
			All 100 squares are filled. Lock the grid, assign random numbers, and start the game.
		</p>
		<button onclick={handleLockGrid} class="btn btn-success w-full" disabled={isLocking}>
			{isLocking ? 'Starting...' : 'Lock Grid & Start Game'}
		</button>
	{:else}
		<p class="text-sm text-secondary">
			Grid is not full yet ({$filledCount}/100). Wait for all squares to be claimed before starting.
		</p>
		<div class="mt-4 progress-bar">
			<div class="progress-bar-fill" style="width: {$filledCount}%"></div>
		</div>
	{/if}
</div>
