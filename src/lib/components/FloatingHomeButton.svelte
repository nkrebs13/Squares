<script lang="ts">
	import { page } from '$app/stores';

	// Hide on home page
	let isHomePage = $derived($page.url.pathname === '/');
</script>

{#if !isHomePage}
	<a
		href="/"
		class="floating-home-btn"
		aria-label="Return to home"
	>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="24"
			height="24"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			<polyline points="9 22 9 12 15 12 15 22" />
		</svg>
	</a>
{/if}

<style>
	.floating-home-btn {
		position: fixed;
		bottom: max(1rem, env(safe-area-inset-bottom, 0px));
		left: max(1rem, env(safe-area-inset-left, 0px));
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(26, 26, 36, 0.85);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		color: var(--text-secondary);
		transition: all 200ms ease;
		z-index: 100;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.floating-home-btn:hover {
		background: rgba(26, 26, 36, 0.95);
		color: var(--text-primary);
		border-color: rgba(100, 210, 200, 0.3);
	}

	.floating-home-btn:active {
		transform: scale(0.95);
	}
</style>
