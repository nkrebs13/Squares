<script lang="ts">
	import { party } from '$lib/stores/game';
	import { browser } from '$app/environment';
	import { APP_CONFIG } from '$lib/config';
	import QRCode from 'qrcode';

	let copied = $state(false);
	let copiedLink = $state(false);
	let showQR = $state(false);
	let qrDataUrl = $state<string | null>(null);
	let shareError = $state<string | null>(null);
	let qrError = $state<string | null>(null);
	let showManualLink = $state(false);

	const joinUrl = $derived(
		$party && browser ? `${window.location.origin}/join?code=${$party.code}` : ''
	);
	const matchupLabel = $derived($party ? `${$party.team_row_name} vs ${$party.team_col_name}` : '');
	const shareTitle = $derived($party?.event_name || APP_CONFIG.appName);
	const shareText = $derived(
		$party ? `Join ${$party.event_name}: ${matchupLabel}. Code ${$party.code}.` : ''
	);

	async function copyText(value: string) {
		if (!navigator.clipboard?.writeText) {
			throw new Error('Clipboard API unavailable');
		}
		await navigator.clipboard.writeText(value);
	}

	async function copyCode() {
		if (!$party) return;
		try {
			await copyText($party.code);
			copied = true;
			shareError = null;
			setTimeout(() => (copied = false), 2000);
		} catch {
			shareError = 'Copy unavailable. Party code is shown above.';
		}
	}

	async function copyLink() {
		if (!joinUrl) return;
		try {
			await copyText(joinUrl);
			copiedLink = true;
			shareError = null;
			showManualLink = false;
			setTimeout(() => (copiedLink = false), 2000);
		} catch {
			shareError = 'Copy unavailable. Join link shown below.';
			showManualLink = true;
		}
	}

	async function toggleQR() {
		showQR = !showQR;
		qrError = null;
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
				// eslint-disable-next-line no-console -- QR failure is non-fatal but worth surfacing in devtools
				console.error('QR generation failed:', err);
				qrError = 'QR code unavailable. Join link shown below.';
				showManualLink = true;
			}
		}
	}

	async function shareCode() {
		if (!$party) return;
		const shareData = {
			title: shareTitle,
			text: shareText,
			url: joinUrl,
		};

		if (navigator.share) {
			try {
				await navigator.share(shareData);
				shareError = null;
			} catch (err) {
				if (err instanceof DOMException && err.name === 'AbortError') return;
				shareError = 'Share unavailable. Join link shown below.';
				showManualLink = true;
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

		{#if shareError}
			<p class="text-xs mt-3 text-error" role="alert">{shareError}</p>
		{/if}

		{#if qrError}
			<p class="text-xs mt-3 text-error" role="alert">{qrError}</p>
		{/if}

		{#if showManualLink && joinUrl}
			<label class="block mt-3 text-left max-w-xs mx-auto">
				<span class="sr-only">Join link</span>
				<input
					readonly
					value={joinUrl}
					class="input text-xs"
					aria-label="Join link"
					onfocus={(event) => event.currentTarget.select()}
				/>
			</label>
		{/if}

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
