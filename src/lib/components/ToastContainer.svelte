<script lang="ts">
	import { toast } from '$lib/stores/toast';
	import Toast from './Toast.svelte';
</script>

{#if $toast.length > 0}
	<div class="toast-container">
		{#each $toast as t (t.id)}
			<Toast
				message={t.message}
				type={t.type}
				duration={t.duration}
				onclose={() => toast.remove(t.id)}
			/>
		{/each}
	</div>
{/if}

<style>
	.toast-container {
		position: fixed;
		bottom: 0;
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 1rem;
		pointer-events: none;
		z-index: 1000;
	}

	.toast-container > :global(*) {
		pointer-events: auto;
	}
</style>
