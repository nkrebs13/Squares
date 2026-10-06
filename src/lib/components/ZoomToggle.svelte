<script lang="ts">
	import type { ZoomState } from '$lib/utils/gridLayout';

	const { zoomState, ontoggle }: { zoomState: ZoomState; ontoggle: () => void } = $props();
</script>

<button
	class="zoom-toggle-btn"
	onclick={ontoggle}
	aria-label={zoomState === 'fit' ? 'Zoom in for larger squares' : 'Fit grid to screen'}
>
	{#if zoomState === 'fit'}
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<circle cx="11" cy="11" r="8" />
			<path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
		</svg>
		<span>Zoom</span>
	{:else}
		<svg
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
		</svg>
		<span>Fit</span>
	{/if}
</button>

<style>
	/* Zoom Toggle Button */
	.zoom-toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		cursor: pointer;
		transition: all 150ms ease;
		min-height: 36px;
	}

	.zoom-toggle-btn svg {
		opacity: 0.8;
		flex-shrink: 0;
	}

	.zoom-toggle-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.zoom-toggle-btn:active {
		transform: scale(0.96);
	}
</style>
