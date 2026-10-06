<script lang="ts">
	import { SPLIT_PRESETS, type SplitPreset } from '$lib/types';

	interface Props {
		/** Name of the selected preset. */
		selected: string;
		onselect: (preset: SplitPreset) => void;
		class?: string;
	}

	const { selected, onselect, class: className = '' }: Props = $props();
</script>

<div class="grid grid-cols-4 gap-2 {className}">
	{#each SPLIT_PRESETS as preset (preset.name)}
		<button
			type="button"
			class="p-2 rounded-lg text-sm font-medium transition-all {selected === preset.name
				? 'btn-primary'
				: 'btn-secondary'}"
			onclick={() => onselect(preset)}
		>
			{preset.name}
		</button>
	{/each}
</div>
