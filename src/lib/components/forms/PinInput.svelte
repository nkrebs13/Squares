<script lang="ts">
	import { PIN_LENGTH } from '$lib/utils/partyForm';

	interface Props {
		value: string;
		class?: string;
	}

	let { value = $bindable(), class: className = '' }: Props = $props();
</script>

<input
	type="tel"
	bind:value
	placeholder={'0'.repeat(PIN_LENGTH)}
	maxlength={PIN_LENGTH}
	pattern="[0-9]*"
	inputmode="numeric"
	class="input text-center text-2xl tracking-widest {className}"
/>
