<script lang="ts">
	import { onMount } from 'svelte';
	import { party } from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import { toast } from '$lib/stores/toast';
	import { isPushSupported, subscribeToPush, isSubscribed, getPushPermission } from '$lib/push';

	let supported = $state(false);
	let subscribed = $state(false);
	let denied = $state(false);
	let subscribing = $state(false);

	onMount(async () => {
		supported = isPushSupported();
		if (!supported) return;

		const permission = await getPushPermission();
		denied = permission === 'denied';
		subscribed = await isSubscribed();
	});

	async function handleOptIn() {
		if (!$party || !$userName) return;

		subscribing = true;
		const result = await subscribeToPush($party.id, $userName);

		if (result.success) {
			subscribed = true;
			toast.success('Notifications enabled!');
		} else if (result.error === 'Permission denied') {
			denied = true;
		} else {
			toast.error(result.error || 'Failed to enable notifications');
		}

		subscribing = false;
	}
</script>

{#if supported && !subscribed && !denied}
	<button class="push-opt-in" onclick={handleOptIn} disabled={subscribing}>
		<svg
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
			<path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
		</svg>
		{subscribing ? 'Enabling...' : 'Enable Notifications'}
	</button>
{/if}

<style>
	.push-opt-in {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 1rem;
		border-radius: 8px;
		font-size: 0.8125rem;
		background: rgba(100, 210, 200, 0.1);
		color: rgba(100, 210, 200, 0.9);
		border: 1px solid rgba(100, 210, 200, 0.2);
		cursor: pointer;
		transition: background 0.15s;
		width: 100%;
		justify-content: center;
	}

	.push-opt-in:hover {
		background: rgba(100, 210, 200, 0.15);
	}

	.push-opt-in:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
