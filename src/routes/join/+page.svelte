<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { userName } from '$lib/stores/user';
	import { getSupabaseClient } from '$lib/supabase';
	import { verifyHostPin } from '$lib/stores/game';
	import { getHostPin, setHostPin } from '$lib/storage';
	import { onMount } from 'svelte';

	let code = $state('');
	let name = $state('');
	let nickname = $state('');
	let isChecking = $state(false);
	let error = $state<string | null>(null);

	// PIN challenge state
	let showPinChallenge = $state(false);
	let pinInput = $state('');
	let pinInputEl = $state<HTMLInputElement | null>(null);
	let pinError = $state<string | null>(null);
	let isVerifyingPin = $state(false);
	let pendingPartyCode = $state('');

	$effect(() => {
		if (showPinChallenge && pinInputEl) {
			pinInputEl.focus();
		}
	});

	onMount(() => {
		const urlCode = $page.url.searchParams.get('code');
		if (urlCode) {
			code = urlCode.toUpperCase();
		}

		// Pre-fill name if we have one stored
		userName.subscribe((storedName) => {
			if (storedName && !name) {
				name = storedName;
			}
		});
	});

	async function handleJoin() {
		if (!code.trim() || !name.trim()) return;

		isChecking = true;
		error = null;

		try {
			const supabase = getSupabaseClient();
			const upperCode = code.toUpperCase();

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

	async function verifyPin() {
		if (pinInput.length !== 4) return;

		isVerifyingPin = true;
		pinError = null;

		try {
			const isValid = await verifyHostPin(pendingPartyCode, pinInput);

			if (isValid) {
				// Store PIN in IndexedDB and session storage
				await setHostPin(pendingPartyCode, pinInput);
				sessionStorage.setItem(`squares_pin_${pendingPartyCode}`, pinInput);

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
			sessionStorage.setItem(`squares_nickname_${partyCode}`, nickname.trim());
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
					maxlength="6"
					autocomplete="off"
					autocapitalize="characters"
				/>
			</label>
		</div>

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
			disabled={!code.trim() || !name.trim() || isChecking}
		>
			{isChecking ? 'Joining...' : 'Join Party'}
		</button>
	</form>
</div>

<!-- PIN Challenge Modal -->
{#if showPinChallenge}
	<div class="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
		<div class="card max-w-sm w-full">
			<h2 class="text-xl font-bold mb-2">Host Name Protected</h2>
			<p class="text-sm mb-4" style="color: var(--text-secondary)">
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
						/>
					</label>
				</div>

				{#if pinError}
					<div class="message-error">
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
	</div>
{/if}
