<script lang="ts">
	import { connectionStatus } from '$lib/stores/game-realtime';

	function refresh() {
		if (typeof location !== 'undefined') location.reload();
	}
</script>

{#if $connectionStatus.status === 'reconnecting'}
	<div class="banner banner-reconnecting" role="status" aria-live="polite">
		<span class="dot dot-reconnecting" aria-hidden="true"></span>
		<span class="message">
			Reconnecting{#if $connectionStatus.attempt > 0}&nbsp;(attempt {$connectionStatus.attempt}){/if}…
		</span>
	</div>
{:else if $connectionStatus.status === 'failed'}
	<div class="banner banner-failed" role="alert" aria-live="assertive">
		<span class="dot dot-failed" aria-hidden="true"></span>
		<span class="message">Connection lost — refresh to resync</span>
		<button type="button" class="refresh-btn" onclick={refresh}>Refresh</button>
	</div>
{/if}

<style>
	.banner {
		position: sticky;
		top: 0;
		z-index: 50;
		display: flex;
		align-items: center;
		gap: 0.625rem;
		padding: 0.625rem 1rem;
		font-size: 0.875rem;
		font-weight: 500;
	}

	.banner-reconnecting {
		background: rgba(245, 158, 11, 0.15);
		color: var(--text-primary);
		border-bottom: 1px solid rgba(245, 158, 11, 0.4);
	}

	.banner-failed {
		background: rgba(239, 68, 68, 0.15);
		color: var(--text-primary);
		border-bottom: 1px solid rgba(239, 68, 68, 0.5);
	}

	.dot {
		width: 0.625rem;
		height: 0.625rem;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.dot-reconnecting {
		background: rgb(245, 158, 11);
		animation: pulse 1s ease-in-out infinite;
	}

	.dot-failed {
		background: rgb(239, 68, 68);
	}

	.message {
		flex: 1;
	}

	.refresh-btn {
		background: rgba(239, 68, 68, 0.9);
		color: white;
		border: none;
		border-radius: 6px;
		padding: 0.375rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 600;
		cursor: pointer;
	}

	.refresh-btn:hover {
		background: rgba(239, 68, 68, 1);
	}

	.refresh-btn:focus-visible {
		outline: 2px solid currentColor;
		outline-offset: 2px;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.4;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.dot-reconnecting {
			animation: none;
		}
	}
</style>
