<script lang="ts">
	import { partyPinKey, setHostPin, setSessionItem } from '$lib/storage';
	import { verifyHostPin } from '$lib/stores/game';
	import { PIN_LENGTH } from '$lib/constants';
	import PinInput from '$lib/components/forms/PinInput.svelte';

	interface Props {
		code: string;
		/** Called with the verified PIN once the host is authorized. */
		onauthorized: (pin: string) => void;
	}

	const { code, onauthorized }: Props = $props();

	let enteredPin = $state('');
	let isVerifyingPin = $state(false);
	let pinError = $state<string | null>(null);

	async function verifyPin() {
		if (enteredPin.length !== PIN_LENGTH) return;

		isVerifyingPin = true;
		pinError = null;

		try {
			const result = await verifyHostPin(code, enteredPin);
			if (result.success) {
				await setHostPin(code, enteredPin);
				setSessionItem(partyPinKey(code), enteredPin);
				onauthorized(enteredPin);
			} else {
				pinError = result.error ?? 'Incorrect PIN. Please try again.';
				enteredPin = '';
			}
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
			disabled={enteredPin.length !== PIN_LENGTH || isVerifyingPin}
		>
			{isVerifyingPin ? 'Verifying...' : 'Verify'}
		</button>
	</form>
</div>
