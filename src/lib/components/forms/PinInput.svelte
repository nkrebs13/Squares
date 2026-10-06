<script lang="ts">
	import { PIN_LENGTH } from '$lib/constants';

	import type { HTMLInputAttributes } from 'svelte/elements';

	interface Props {
		value: string;
		class?: string;
		autocomplete?: HTMLInputAttributes['autocomplete'];
	}

	let { value = $bindable(), class: className = '', autocomplete }: Props = $props();
</script>

<input
	type="tel"
	bind:value
	placeholder={'0'.repeat(PIN_LENGTH)}
	maxlength={PIN_LENGTH}
	pattern="[0-9]*"
	inputmode="numeric"
	{autocomplete}
	class="input text-center text-2xl tracking-widest {className}"
/>
