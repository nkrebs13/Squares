<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { hasSeenGestureHint, markGestureHintSeen } from '$lib/storage';

	let show = $state(false);
	let isTouchDevice = $state(false);
	let timeout: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		if (!browser) return;

		isTouchDevice =
			typeof window.matchMedia === 'function'
				? window.matchMedia('(pointer: coarse)').matches
				: false;

		const seen = await hasSeenGestureHint();
		if (!seen) {
			show = true;
			scheduleAutoDismiss();
		}
	});

	onDestroy(() => {
		if (timeout) {
			clearTimeout(timeout);
		}
	});

	function scheduleAutoDismiss() {
		if (timeout) {
			clearTimeout(timeout);
		}
		// Auto-dismiss after 5 seconds
		timeout = setTimeout(() => {
			dismiss();
		}, 5000);
	}

	async function dismiss() {
		show = false;
		if (timeout) {
			clearTimeout(timeout);
			timeout = null;
		}
		await markGestureHintSeen();
	}

	// Re-shows the hint on demand (e.g. from a "?" help affordance) without
	// touching the persisted seen-flag — the flag only tracks the first,
	// automatic appearance.
	export function reopen() {
		show = true;
		scheduleAutoDismiss();
	}
</script>

{#if show}
	<button class="gesture-hint-overlay" onclick={dismiss} aria-label="Dismiss hint">
		<div class="gesture-hint-card" role="status" aria-live="polite">
			<div class="hint-row">
				<span class="hint-icon">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
						<line x1="11" y1="8" x2="11" y2="14"></line>
						<line x1="8" y1="11" x2="14" y2="11"></line>
					</svg>
				</span>
				<span>Tap Zoom to enlarge grid</span>
			</div>
			<div class="hint-row">
				<span class="hint-icon">
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<path
							d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"
						></path>
					</svg>
				</span>
				<span>{isTouchDevice ? 'Tap to claim' : 'Click to claim'}</span>
			</div>
			{#if isTouchDevice}
				<div class="hint-row">
					<span class="hint-icon">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path
								d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"
							></path>
						</svg>
					</span>
					<span>Tap again to unclaim your square</span>
				</div>
			{:else}
				<div class="hint-row">
					<span class="hint-icon">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path
								d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3zM7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"
							></path>
						</svg>
					</span>
					<span>Click again to unclaim your square</span>
				</div>
				<div class="hint-row">
					<span class="hint-icon">
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="20"
							height="20"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
							<line x1="9" y1="3" x2="9" y2="21"></line>
							<line x1="15" y1="3" x2="15" y2="21"></line>
							<line x1="3" y1="9" x2="21" y2="9"></line>
							<line x1="3" y1="15" x2="21" y2="15"></line>
						</svg>
					</span>
					<span>Click and drag to select multiple</span>
				</div>
			{/if}
			<div class="hint-dismiss">Tap to dismiss</div>
		</div>
	</button>
{/if}

<style>
	.gesture-hint-overlay {
		position: fixed;
		inset: 0;
		z-index: 200;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(0, 0, 0, 0.6);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
		border: none;
		cursor: pointer;
		animation: fadeIn 0.3s ease-out;
	}

	.gesture-hint-card {
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 16px;
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
		animation: scaleIn 0.3s ease-out;
	}

	.hint-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		color: var(--text-primary);
		font-size: 0.9375rem;
	}

	.hint-icon {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		background: rgba(100, 210, 200, 0.15);
		border-radius: 8px;
		color: rgba(100, 210, 200, 0.9);
	}

	.hint-dismiss {
		text-align: center;
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-top: 0.5rem;
	}

	@keyframes fadeIn {
		from {
			opacity: 0;
		}
		to {
			opacity: 1;
		}
	}

	@keyframes scaleIn {
		from {
			transform: scale(0.9);
			opacity: 0;
		}
		to {
			transform: scale(1);
			opacity: 1;
		}
	}
</style>
