<script lang="ts">
	import { party } from '$lib/stores/game';

	let copied = $state(false);

	async function copyCode() {
		if (!$party) return;
		try {
			await navigator.clipboard.writeText($party.code);
			copied = true;
			setTimeout(() => (copied = false), 2000);
		} catch {
			// Copy failed silently - user can retry
		}
	}

	async function shareCode() {
		if (!$party) return;
		const shareData = {
			title: 'Football Squares',
			text: `Join my Football Squares party!`,
			url: `${window.location.origin}/join?code=${$party.code}`
		};

		if (navigator.share) {
			try {
				await navigator.share(shareData);
			} catch (e) {
				// User cancelled or share failed
			}
		} else {
			copyCode();
		}
	}
</script>

{#if $party}
	<div class="card text-center">
		<div class="text-sm opacity-70 mb-2">Party Code</div>
		<div class="party-code">{$party.code}</div>

		<div class="mt-4 flex gap-3 justify-center">
			<button onclick={copyCode} class="btn btn-secondary text-sm">
				{copied ? 'Copied!' : 'Copy'}
			</button>
			<button onclick={shareCode} class="btn btn-primary text-sm">
				Share
			</button>
		</div>
	</div>
{/if}
