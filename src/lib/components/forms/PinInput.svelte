<script lang="ts">
	/* eslint-disable prefer-const -- $bindable props are written through bind:, which prefer-const cannot see */
	interface Props {
		value: string;
		class?: string;
		id?: string;
		placeholder?: string;
	}

	let { value = $bindable(), class: className = '', id, placeholder = '0000' }: Props = $props();
</script>

<input
	{id}
	type="tel"
	bind:value
	{placeholder}
	maxlength="4"
	pattern="[0-9]*"
	inputmode="numeric"
	class="input text-center text-2xl tracking-widest {className}"
/>
