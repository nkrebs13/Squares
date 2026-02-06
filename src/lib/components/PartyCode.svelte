<script lang="ts">
	import { party } from '$lib/stores/game';
	import { browser } from '$app/environment';
	import QRCode from 'qrcode';

	let copied = $state(false);
	let copiedLink = $state(false);
	let showQR = $state(false);
	let qrDataUrl = $state<string | null>(null);

	const joinUrl = $derived(
		$party && browser ? `${window.location.origin}/join?code=${$party.code}` : ''
	);

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

	async function copyLink() {
		if (!joinUrl) return;
		try {
			await navigator.clipboard.writeText(joinUrl);
			copiedLink = true;
			setTimeout(() => (copiedLink = false), 2000);
		} catch {
			// Copy failed silently
		}
	}

	async function toggleQR() {
		showQR = !showQR;
		if (showQR && !qrDataUrl && joinUrl) {
			try {
				qrDataUrl = await QRCode.toDataURL(joinUrl, {
					width: 200,
					margin: 2,
					color: {
						dark: '#e2e8f0',
						light: '#1a1a24',
					},
				});
			} catch (err) {
				// eslint-disable-next-line no-console
				console.error('QR generation failed:', err);
			}
		}
	}

	async function shareCode() {
		if (!$party) return;
		const shareData = {
			title: 'Football Squares',
			text: `Join my Football Squares party!`,
			url: joinUrl,
		};

		if (navigator.share) {
			try {
				await navigator.share(shareData);
			} catch {
				// User cancelled or share failed
			}
		} else {
			copyLink();
		}
	}
</script>

{#if $party}
	<div class="card text-center">
		<div class="text-sm opacity-70 mb-2">Party Code</div>
		<div class="party-code">{$party.code}</div>

		<div class="mt-4 grid grid-cols-2 gap-2 max-w-xs mx-auto">
			<button onclick={copyCode} class="btn btn-secondary text-sm w-full">
				{copied ? 'Copied!' : 'Copy Code'}
			</button>
			<button onclick={copyLink} class="btn btn-secondary text-sm w-full">
				{copiedLink ? 'Copied!' : 'Copy Link'}
			</button>
			<button onclick={shareCode} class="btn btn-primary text-sm w-full">Share</button>
			<button onclick={toggleQR} class="btn btn-secondary text-sm w-full">
				{showQR ? 'Hide QR' : 'QR Code'}
			</button>
		</div>

		{#if showQR && qrDataUrl}
			<div class="mt-4 flex justify-center">
				<img
					src={qrDataUrl}
					alt="QR code to join party"
					class="rounded-lg"
					width="200"
					height="200"
				/>
			</div>
			<p class="text-xs mt-2" style="color: var(--text-muted)">Scan to join this party</p>
		{/if}
	</div>
{/if}
