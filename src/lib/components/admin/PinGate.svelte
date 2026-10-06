<script lang="ts">
	import { partyPinKey, setHostPin, setSessionItem } from '$lib/storage';
	import { verifyHostPin } from '$lib/stores/game';
	import PinInput from '$lib/components/forms/PinInput.svelte';

	const MAX_PIN_ATTEMPTS = 5;

	interface Props {
		code: string;
		/** Called with the verified PIN once the host is authorized. */
		onauthorized: (pin: string) => void;
	}

	const { code, onauthorized }: Props = $props();

	let enteredPin = $state('');
	let isVerifyingPin = $state(false);
	let pinError = $state<string | null>(null);
	let pinAttempts = $state(0);

	async function verifyPin() {
		if (enteredPin.length !== 4 || pinAttempts >= MAX_PIN_ATTEMPTS) return;

		isVerifyingPin = true;
		pinError = null;

		try {
			const isValid = await verifyHostPin(code, enteredPin);
			if (isValid) {
				await setHostPin(code, enteredPin);
				setSessionItem(partyPinKey(code), enteredPin);
				pinAttempts = 0;
				onauthorized(enteredPin);
			} else {
				pinAttempts++;
				if (pinAttempts >= MAX_PIN_ATTEMPTS) {
					pinError = 'Too many attempts. Try again later.';
				} else {
					pinError = 'Incorrect PIN. Please try again.';
				}
				enteredPin = '';
			}
		} catch {
			pinError = 'Unable to verify PIN. Please try again.';
		} finally {
			isVerifyingPin = false;
		}
	}
</script>

<div class="card max-w-md mx-auto">
	<h2 class="text-xl font-semibold mb-4">Enter Host PIN</h2>
	<form
		onsubmit={(e) => {
			e.preventDefault();
			verifyPin();
		}}
	>
		<PinInput bind:value={enteredPin} class="mb-4" />
		{#if pinError}
			<div class="message-error mb-4">
				{pinError}
			</div>
		{/if}
		<button
			type="submit"
			class="btn btn-primary w-full"
			disabled={enteredPin.length !== 4 || isVerifyingPin || pinAttempts >= MAX_PIN_ATTEMPTS}
		>
			{isVerifyingPin ? 'Verifying...' : 'Verify'}
		</button>
	</form>
</div>
