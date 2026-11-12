<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { userName } from '$lib/stores/user';
	import { verifyHostPin } from '$lib/stores/game';
	import { recallHostPin, rememberHostPin } from '$lib/hostPin';
	import { stageNickname } from '$lib/recentParties';
	import { MAX_NAME_LENGTH, MAX_NICKNAME_LENGTH, PIN_LENGTH, TOTAL_SQUARES } from '$lib/constants';
	import PinInput from '$lib/components/forms/PinInput.svelte';
	import Modal from '$lib/components/forms/Modal.svelte';
	import PayoutPreview from '$lib/components/forms/PayoutPreview.svelte';
	import {
		fetchPartyPreview,
		PREVIEW_NOT_FOUND_ERROR,
		type PartyPreview,
	} from '$lib/services/partyPreview';
	import { formatKickoff } from '$lib/utils/datetime';
	import { formatMatchup, formatPrice } from '$lib/utils/format';
	import { isCompletePartyCode, normalizePartyCode } from '$lib/utils/partyCode';
	import { onMount } from 'svelte';

	let code = $state('');
	let name = $state('');
	// Prefill from the stored name until the user edits the field or backs out
	// of the host check (which clears it on purpose).
	let nameTouched = false;
	$effect(() => {
		if (!nameTouched && $userName && !name) name = $userName;
	});
	let nickname = $state('');
	let isChecking = $state(false);
	let error = $state<string | null>(null);
	let preview = $state<PartyPreview | null>(null);
	let isLoadingPreview = $state(false);
	let previewError = $state<string | null>(null);
	let previewRequestId = 0;
	let showPinChallenge = $state(false);
	let pinInput = $state('');
	let pinError = $state<string | null>(null);
	let isVerifyingPin = $state(false);
	let pendingPartyCode = $state('');

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
			const upperCode = normalizePartyCode(code);

			const partyData = (await fetchPartyPreview(upperCode))?.party ?? null;

			if (!partyData) {
				error = 'Party not found. Check the code and try again.';
				return;
			}

			const enteredNameLower = name.trim().toLowerCase();
			if (partyData.host_name_lower && enteredNameLower === partyData.host_name_lower) {
				const storedPin = await recallHostPin(upperCode);
				if (storedPin) {
					const verified = await verifyHostPin(upperCode, storedPin);
					if (verified.success) {
						userName.setName(name.trim());
						stageNickname(upperCode, nickname);
						goto(`/party/${upperCode}`);
						return;
					}
				}

				pendingPartyCode = upperCode;
				showPinChallenge = true;
				pinInput = '';
				pinError = null;
				return;
			}

			userName.setName(name.trim());
			stageNickname(upperCode, nickname);
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
			const result = await fetchPartyPreview(partyCode);
			if (requestId !== previewRequestId) return;

			preview = result;
			previewError = result ? null : PREVIEW_NOT_FOUND_ERROR;
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
		if (pinInput.length !== PIN_LENGTH) return;

		isVerifyingPin = true;
		pinError = null;

		try {
			const result = await verifyHostPin(pendingPartyCode, pinInput);

			if (result.success) {
				await rememberHostPin(pendingPartyCode, pinInput);

				userName.setName(name.trim());
				stageNickname(pendingPartyCode, nickname);
				showPinChallenge = false;
				goto(`/party/${pendingPartyCode}`);
			} else {
				pinError = result.error ?? 'Incorrect PIN. Please try again.';
				pinInput = '';
			}
		} catch {
			pinError = 'Unable to verify PIN. Please try again.';
		} finally {
			isVerifyingPin = false;
		}
	}

	function cancelPinChallenge() {
		showPinChallenge = false;
		pinInput = '';
		pinError = null;
		nameTouched = true;
		name = '';
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/" class="text-sm hover:opacity-100 text-secondary">← Back</a>
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
				<span class="text-sm text-secondary">Party Code</span>
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
				<span class="text-sm text-secondary">Party preview</span>
				{#if isLoadingPreview}
					<p class="mt-2 text-sm text-muted">Looking up this party...</p>
				{:else if preview}
					<div class="mt-2">
						<div class="font-semibold">{preview.party.event_name}</div>
						<div class="mt-1 text-sm text-secondary">
							{formatMatchup(preview.party.team_row_name, preview.party.team_col_name)}
						</div>
						<div class="mt-3 grid grid-cols-2 gap-3">
							<div>
								<div class="text-xs uppercase text-muted">Price per square</div>
								<div class="font-semibold">{formatPrice(preview.party.square_price)}</div>
							</div>
							<div>
								<div class="text-xs uppercase text-muted">Open squares</div>
								<div class="font-semibold">
									{TOTAL_SQUARES - preview.filledCount}
								</div>
							</div>
						</div>
						<PayoutPreview
							splits={{
								q1: preview.party.split_q1,
								q2: preview.party.split_q2,
								q3: preview.party.split_q3,
								final: preview.party.split_final,
							}}
							squarePrice={preview.party.square_price}
							testIdPrefix="join"
							class="mt-3"
						/>
						{#if formatKickoff(preview.party.kickoff_at)}
							<div class="mt-1 text-sm text-muted">
								{formatKickoff(preview.party.kickoff_at, {
									includeWeekday: true,
									includeTimeZone: true,
								})}
							</div>
						{/if}
						<div class="mt-2 text-xs uppercase text-muted">
							{preview.party.status}
						</div>
					</div>
				{:else if previewError}
					<p class="mt-2 text-sm" style="color: #fca5a5">{previewError}</p>
				{/if}
			</div>
		{/if}

		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Your Name</span>
				<input
					type="text"
					bind:value={name}
					oninput={() => (nameTouched = true)}
					placeholder="Enter your name"
					class="input mt-2"
					maxlength={MAX_NAME_LENGTH}
					autocomplete="name"
					onblur={() => (name = name.trim())}
				/>
			</label>
			<p class="mt-2 text-sm text-muted">Use the same name to claim more squares later</p>
		</div>

		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Game Nickname</span>
				<span class="text-xs ml-1 text-muted">(optional)</span>
				<input
					type="text"
					bind:value={nickname}
					placeholder="e.g. Work Pool, Family Game"
					class="input mt-2"
					maxlength={MAX_NICKNAME_LENGTH}
				/>
			</label>
			<p class="mt-2 text-sm text-muted">Helps you tell games apart if you're in multiple pools</p>
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

<Modal
	open={showPinChallenge}
	labelledBy="pin-modal-title"
	describedBy="pin-modal-description"
	ondismiss={cancelPinChallenge}
>
	<div class="card max-w-sm w-full">
		<h2 id="pin-modal-title" class="text-xl font-bold mb-2">Host Name Protected</h2>
		<p id="pin-modal-description" class="text-sm mb-4 text-secondary">
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
					<span class="text-sm text-secondary">Enter Host PIN</span>
					<PinInput bind:value={pinInput} class="mt-2" autocomplete="off" />
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
					disabled={pinInput.length !== PIN_LENGTH || isVerifyingPin}
				>
					{isVerifyingPin ? 'Verifying...' : 'Verify'}
				</button>
			</div>
		</form>
	</div>
</Modal>
