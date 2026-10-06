<script lang="ts">
	interface Props {
		ondelete: () => void;
	}

	const { ondelete }: Props = $props();
</script>

<div class="card border border-red-500/30">
	<h2 class="text-lg font-semibold mb-2 text-red-400">Danger Zone</h2>
	<p class="text-sm mb-4 text-secondary">Permanently delete this party and all associated data.</p>
	<button onclick={ondelete} class="btn btn-danger-outline w-full"> Delete Party </button>
</div>
