<script lang="ts">
	import { fly } from 'svelte/transition';
	import { prefersReducedMotion } from 'svelte/motion';
	import { toast } from '$lib/stores/toast';

	const motion = $derived({ y: 20, duration: prefersReducedMotion.current ? 0 : 300 });
</script>

<!-- Always mounted so a leaving toast can play its exit even when it is the last one. -->
<div class="toast-container">
	{#each $toast as t (t.id)}
		<div
			class="toast toast-{t.type}"
			role={t.type === 'error' ? 'alert' : 'status'}
			aria-live={t.type === 'error' ? 'assertive' : 'polite'}
			transition:fly={motion}
		>
			<svg
				class="toast-icon"
				xmlns="http://www.w3.org/2000/svg"
				width="18"
				height="18"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				{#if t.type === 'success'}
					<polyline points="20 6 9 17 4 12"></polyline>
				{:else if t.type === 'error'}
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="15" y1="9" x2="9" y2="15"></line>
					<line x1="9" y1="9" x2="15" y2="15"></line>
				{:else}
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="16" x2="12" y2="12"></line>
					<line x1="12" y1="8" x2="12.01" y2="8"></line>
				{/if}
			</svg>
			<span class="toast-message">{t.message}</span>
		</div>
	{/each}
</div>

<style>
	.toast-container {
		position: fixed;
		bottom: max(5rem, calc(env(safe-area-inset-bottom, 0px) + 5rem));
		left: 0;
		right: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0 1rem;
		pointer-events: none;
		z-index: 1000;
	}

	.toast {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		max-width: 100%;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 500;
		pointer-events: auto;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.toast-success {
		background: rgb(var(--rgb-success) / 0.9);
		color: #0f0f14;
	}

	.toast-error {
		background: rgb(var(--rgb-error) / 0.9);
		color: white;
	}

	.toast-info {
		background: rgb(var(--rgb-sky) / 0.9);
		color: #0f0f14;
	}

	.toast-icon {
		flex-shrink: 0;
	}
</style>
