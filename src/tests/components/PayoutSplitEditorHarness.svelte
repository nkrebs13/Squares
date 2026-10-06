<script lang="ts">
	import PayoutSplitEditor from '$lib/components/forms/PayoutSplitEditor.svelte';

	interface Props {
		variant: 'create' | 'admin';
	}

	const { variant }: Props = $props();

	// Hosts the editor the way the pages do: parent-owned reactive state, bound in.
	let splits = $state({ q1: 10, q2: 20, q3: 30, final: 40 });
	let selectedPreset = $state('Rising');
</script>

<PayoutSplitEditor bind:splits bind:selectedPreset {variant} />
<output data-testid="harness-splits">{JSON.stringify(splits)}</output>
<output data-testid="harness-preset">{selectedPreset}</output>
