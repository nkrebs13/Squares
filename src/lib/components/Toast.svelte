<script lang="ts">
	import { onMount } from 'svelte';

	interface Props {
		message: string;
		type?: 'success' | 'error' | 'info';
		duration?: number;
		onclose?: () => void;
	}

	const { message, type = 'info', duration = 3000, onclose }: Props = $props();

	let visible = $state(true);

	onMount(() => {
		const timer = setTimeout(() => {
			visible = false;
			setTimeout(() => onclose?.(), 300);
		}, duration);

		return () => clearTimeout(timer);
	});
</script>

{#if visible}
	<div class="toast toast-{type}" class:toast-exit={!visible}>
		<span class="toast-icon">
			{#if type === 'success'}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<polyline points="20 6 9 17 4 12"></polyline>
				</svg>
			{:else if type === 'error'}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="15" y1="9" x2="9" y2="15"></line>
					<line x1="9" y1="9" x2="15" y2="15"></line>
				</svg>
			{:else}
				<svg
					xmlns="http://www.w3.org/2000/svg"
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					stroke-linecap="round"
					stroke-linejoin="round"
				>
					<circle cx="12" cy="12" r="10"></circle>
					<line x1="12" y1="16" x2="12" y2="12"></line>
					<line x1="12" y1="8" x2="12.01" y2="8"></line>
				</svg>
			{/if}
		</span>
		<span class="toast-message">{message}</span>
	</div>
{/if}

<style>
	.toast {
		position: fixed;
		bottom: max(5rem, calc(env(safe-area-inset-bottom, 0px) + 5rem));
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		font-size: 0.875rem;
		font-weight: 500;
		z-index: 1000;
		animation: toast-enter 0.3s ease-out;
		box-shadow: 0 4px 24px rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
	}

	.toast-exit {
		animation: toast-exit 0.3s ease-out forwards;
	}

	@keyframes toast-enter {
		from {
			opacity: 0;
			transform: translateX(-50%) translateY(20px);
		}
		to {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
	}

	@keyframes toast-exit {
		from {
			opacity: 1;
			transform: translateX(-50%) translateY(0);
		}
		to {
			opacity: 0;
			transform: translateX(-50%) translateY(20px);
		}
	}

	.toast-success {
		background: rgba(100, 200, 130, 0.9);
		color: #0f0f14;
	}

	.toast-error {
		background: rgba(239, 68, 68, 0.9);
		color: white;
	}

	.toast-info {
		background: rgba(100, 170, 230, 0.9);
		color: #0f0f14;
	}

	.toast-icon {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.toast-message {
		white-space: nowrap;
	}
</style>
