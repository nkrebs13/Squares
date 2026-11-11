<script lang="ts">
	interface Props {
		reset: () => void;
	}

	const { reset }: Props = $props();
</script>

<div class="card" style="border: 1px solid rgba(239, 68, 68, 0.3);">
	<p class="text-sm" style="color: #f87171;">This section encountered an error.</p>
	<div class="flex gap-2 mt-2">
		<button class="btn btn-secondary btn-sm" type="button" onclick={reset}>Try again</button>
		<button class="btn btn-secondary btn-sm" type="button" onclick={() => window.location.reload()}
			>Reload</button
		>
	</div>
</div>
