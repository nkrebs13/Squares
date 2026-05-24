<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { userName } from '$lib/stores/user';
	import { getSupabaseClient } from '$lib/supabase';
	import { verifyHostPin } from '$lib/stores/game';
	import {
		getHostPin,
		setHostPin,
		partyPinKey,
		partyNicknameKey,
		setSessionItem,
	} from '$lib/storage';
	import type { PartyStatus } from '$lib/types';
	import { formatKickoff } from '$lib/utils/datetime';
	import { formatPrice } from '$lib/utils/format';
	import { isCompletePartyCode, normalizePartyCode } from '$lib/utils/partyCode';
	import { onMount } from 'svelte';

	interface PartyPreview {
		id: string;
		eventName: string;
		kickoffAt: string | null;
		status: PartyStatus;
		teamRowName: string;
		teamColName: string;
		squarePrice: number;
		filledCount: number | null;
	}

	let code = $state('');
	let name = $state('');
	let nickname = $state('');
	let isChecking = $state(false);
	let error = $state<string | null>(null);
	let preview = $state<PartyPreview | null>(null);
	let isLoadingPreview = $state(false);
	let previewError = $state<string | null>(null);
	let previewRequestId = 0;

	// PIN challenge state
	let showPinChallenge = $state(false);
	let pinInput = $state('');
	let pinInputEl = $state<HTMLInputElement | null>(null);
	let pinDialogEl: HTMLDialogElement | null = null;
	let pinError = $state<string | null>(null);
	let isVerifyingPin = $state(false);
	let pendingPartyCode = $state('');

	$effect(() => {
		if (showPinChallenge) {
			if (pinDialogEl && !pinDialogEl.open) pinDialogEl.showModal();
		} else {
			if (pinDialogEl?.open) pinDialogEl.close();
		}
	});

	// Sync stored name into the field on first load; $effect handles teardown automatically.
	$effect(() => {
		if ($userName && !name) name = $userName;
	});

	$effect(() => {
		const normalizedCode = normalizePartyCode(code);
		if (!isCompletePartyCode(normalizedCode)) {
			previewRequestId += 1;
			preview = null;
			previewError = null;
			isLoadingPreview = false;
			return;
		}

		void loadPartyPreview(normalizedCode);
	});

	onMount(() => {
		const urlCode = $page.url.searchParams.get('code');
		if (urlCode) {
			code = normalizePartyCode(urlCode);
		}
	});

	async function handleJoin() {
		if (!isCompletePartyCode(code) || !name.trim()) return;

		isChecking = true;
		error = null;

		try {
			const supabase = getSupabaseClient();
			const upperCode = normalizePartyCode(code);

			// Check if party exists and get host_name_lower
			const { data: partyData, error: partyError } = await supabase
				.from('parties')
				.select('id, status, host_name_lower')
				.eq('code', upperCode)
				.single();

			if (partyError || !partyData) {
				error = 'Party not found. Check the code and try again.';
				return;
			}

			// Check if entered name matches host name (case-insensitive)
			const enteredNameLower = name.trim().toLowerCase();
			if (partyData.host_name_lower && enteredNameLower === partyData.host_name_lower) {
				// Check if we have a valid stored PIN for this party
				const storedPin = await getHostPin(upperCode);
				if (storedPin) {
					// Verify stored PIN is still valid
					const isValid = await verifyHostPin(upperCode, storedPin);
					if (isValid) {
						// Stored PIN is valid, proceed directly
						userName.setName(name.trim());
						storeNickname(upperCode);
						goto(`/party/${upperCode}`);
						return;
					}
				}

				// No valid stored PIN, show challenge
				pendingPartyCode = upperCode;
				showPinChallenge = true;
				pinInput = '';
				pinError = null;
				return;
			}

			// Not the host name, proceed normally
			userName.setName(name.trim());
			storeNickname(upperCode);
			goto(`/party/${upperCode}`);
		} catch {
			error = 'Something went wrong. Please try again.';
		} finally {
			isChecking = false;
		}
	}

	async function loadPartyPreview(partyCode: string) {
		const requestId = ++previewRequestId;
		isLoadingPreview = true;
		previewError = null;

		try {
			const supabase = getSupabaseClient();
			const { data, error: partyError } = await supabase
				.from('parties')
				.select('id, event_name, kickoff_at, status, team_row_name, team_col_name, square_price')
				.eq('code', partyCode)
				.single();

			if (requestId !== previewRequestId) return;

			if (partyError || !data) {
				preview = null;
				previewError = 'No party found for this code.';
				return;
			}

			const { data: squaresData } = await supabase
				.from('squares')
				.select('player_name, claimed_at')
				.eq('party_id', data.id);

			if (requestId !== previewRequestId) return;

			preview = {
				id: data.id,
				eventName: data.event_name,
				kickoffAt: data.kickoff_at,
				status: data.status,
				teamRowName: data.team_row_name,
				teamColName: data.team_col_name,
				squarePrice: data.square_price,
				filledCount: Array.isArray(squaresData)
					? squaresData.filter((square) => square.player_name || square.claimed_at).length
					: null,
			};
		} catch {
			if (requestId === previewRequestId) {
				preview = null;
				previewError = 'Unable to preview this party.';
			}
		} finally {
			if (requestId === previewRequestId) {
				isLoadingPreview = false;
			}
		}
	}

	async function verifyPin() {
		if (pinInput.length !== 4) return;

		isVerifyingPin = true;
		pinError = null;

		try {
			const isValid = await verifyHostPin(pendingPartyCode, pinInput);

			if (isValid) {
				// Store PIN in IndexedDB and session storage
				await setHostPin(pendingPartyCode, pinInput);
				setSessionItem(partyPinKey(pendingPartyCode), pinInput);

				// Proceed to party
				userName.setName(name.trim());
				storeNickname(pendingPartyCode);
				showPinChallenge = false;
				goto(`/party/${pendingPartyCode}`);
			} else {
				pinError = 'Incorrect PIN. Please try again.';
				pinInput = '';
			}
		} catch {
			pinError = 'Unable to verify PIN. Please try again.';
		} finally {
			isVerifyingPin = false;
		}
	}

	function storeNickname(partyCode: string) {
		if (nickname.trim()) {
			setSessionItem(partyNicknameKey(partyCode), nickname.trim());
		}
	}

	function cancelPinChallenge() {
		showPinChallenge = false;
		pinInput = '';
		pinError = null;
		name = '';
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Back</a>
		<h1 class="text-3xl font-bold mt-2">Join Party</h1>
	</header>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			handleJoin();
		}}
		class="space-y-6 max-w-md mx-auto"
	>
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Party Code</span>
				<input
					type="text"
					bind:value={code}
					placeholder="ABCD12"
					class="input mt-2 text-center text-2xl tracking-widest uppercase"
					maxlength="12"
					autocomplete="off"
					autocapitalize="characters"
				/>
			</label>
			{#if code && !isCompletePartyCode(code)}
				<p class="mt-2 text-sm" style="color: #fca5a5">Party codes are 6 characters.</p>
			{/if}
		</div>

		{#if isCompletePartyCode(code)}
			<div class="card">
				<span class="text-sm" style="color: var(--text-secondary)">Party preview</span>
				{#if isLoadingPreview}
					<p class="mt-2 text-sm" style="color: var(--text-muted)">Looking up this party...</p>
				{:else if preview}
					<div class="mt-2">
						<div class="font-semibold">{preview.eventName}</div>
						<div class="mt-1 text-sm" style="color: var(--text-secondary)">
							{preview.teamRowName} vs {preview.teamColName}
						</div>
						<div class="mt-3 grid grid-cols-2 gap-3">
							<div>
								<div class="text-xs uppercase" style="color: var(--text-muted)">
									Price per square
								</div>
								<div class="font-semibold">{formatPrice(preview.squarePrice)}</div>
							</div>
							<div>
								<div class="text-xs uppercase" style="color: var(--text-muted)">Open squares</div>
								<div class="font-semibold">
									{preview.filledCount === null ? 'Checking...' : 100 - preview.filledCount}
								</div>
							</div>
						</div>
						<p class="mt-2 text-sm" style="color: var(--text-muted)">
							Full pot: {formatPrice(preview.squarePrice * 100)}
						</p>
						{#if formatKickoff(preview.kickoffAt)}
							<div class="mt-1 text-sm" style="color: var(--text-muted)">
								{formatKickoff(preview.kickoffAt, {
									includeWeekday: true,
									includeTimeZone: true,
								})}
							</div>
						{/if}
						<div class="mt-2 text-xs uppercase" style="color: var(--text-muted)">
							{preview.status}
						</div>
					</div>
				{:else if previewError}
					<p class="mt-2 text-sm" style="color: #fca5a5">{previewError}</p>
				{/if}
			</div>
		{/if}

		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Your Name</span>
				<input
					type="text"
					bind:value={name}
					placeholder="Enter your name"
					class="input mt-2"
					maxlength="20"
					autocomplete="name"
					onblur={() => (name = name.trim())}
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Use the same name to claim more squares later
			</p>
		</div>

		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Game Nickname</span>
				<span class="text-xs ml-1" style="color: var(--text-muted)">(optional)</span>
				<input
					type="text"
					bind:value={nickname}
					placeholder="e.g. Work Pool, Family Game"
					class="input mt-2"
					maxlength="30"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Helps you tell games apart if you're in multiple pools
			</p>
		</div>

		{#if error}
			<div class="message-error">
				{error}
			</div>
		{/if}

		<button
			type="submit"
			class="btn btn-primary w-full"
			disabled={!isCompletePartyCode(code) || !name.trim() || isChecking}
		>
			{isChecking ? 'Joining...' : 'Join Party'}
		</button>
	</form>
</div>

<!-- PIN Challenge Modal — native <dialog> for real focus trapping, backdrop, and Escape handling -->
<dialog
	bind:this={pinDialogEl}
	aria-labelledby="pin-modal-title"
	aria-describedby="pin-modal-description"
	onclose={cancelPinChallenge}
	onclick={(e) => {
		if (e.target === pinDialogEl) cancelPinChallenge();
	}}
	class="pin-dialog"
>
	{#if showPinChallenge}
		<div class="card max-w-sm w-full">
			<h2 id="pin-modal-title" class="text-xl font-bold mb-2">Host Name Protected</h2>
			<p id="pin-modal-description" class="text-sm mb-4" style="color: var(--text-secondary)">
				This name belongs to the party host. Enter the host PIN to continue.
			</p>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					verifyPin();
				}}
				class="space-y-4"
			>
				<div>
					<label class="block">
						<span class="text-sm" style="color: var(--text-secondary)">Enter Host PIN</span>
						<input
							type="tel"
							bind:value={pinInput}
							bind:this={pinInputEl}
							placeholder="0000"
							maxlength="4"
							pattern="[0-9]*"
							inputmode="numeric"
							class="input mt-2 text-center text-2xl tracking-widest"
							autocomplete="off"
						/>
					</label>
				</div>

				{#if pinError}
					<div class="message-error" role="alert">
						{pinError}
					</div>
				{/if}

				<div class="flex gap-3">
					<button type="button" class="btn btn-secondary flex-1" onclick={cancelPinChallenge}>
						Use Different Name
					</button>
					<button
						type="submit"
						class="btn btn-primary flex-1"
						disabled={pinInput.length !== 4 || isVerifyingPin}
					>
						{isVerifyingPin ? 'Verifying...' : 'Verify'}
					</button>
				</div>
			</form>
		</div>
	{/if}
</dialog>

<style>
	.pin-dialog {
		background: transparent;
		border: none;
		padding: 1rem;
		max-width: min(calc(100vw - 2rem), 24rem);
		width: 100%;
		margin: auto;
	}

	.pin-dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}
</style>
