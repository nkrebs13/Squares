<script lang="ts">
	/* eslint-disable prefer-const -- $bindable props are written through bind:, which prefer-const cannot see */
	import type { PayoutSplits } from '$lib/payouts';
	import { SPLIT_PRESETS, type Quarter, type SplitPreset } from '$lib/types';

	const CUSTOM_PRESET_NAME = 'Custom';
	const QUARTER_KEYS: Quarter[] = ['q1', 'q2', 'q3', 'final'];
	const DEFAULT_CUSTOM_SPLIT: PayoutSplits = { q1: 25, q2: 25, q3: 25, final: 25 };

	interface Props {
		/** Effective split percentages. The editor writes to these when a preset is picked or an input is edited. */
		splits: PayoutSplits;
		/** Name of the selected preset ('Custom' when hand-edited). */
		selectedPreset: string;
		/**
		 * 'create': inputs only appear under Custom (other presets show static percentages),
		 * and Custom restores the last hand-entered split (25/25/25/25 initially).
		 * 'admin': inputs are always editable; editing flips the preset to Custom.
		 */
		variant?: 'create' | 'admin';
	}

	let { splits = $bindable(), selectedPreset = $bindable(), variant = 'create' }: Props = $props();

	const isCreate = $derived(variant === 'create');
	const isCustom = $derived(selectedPreset === CUSTOM_PRESET_NAME);
	const showInputs = $derived(!isCreate || isCustom);
	const splitTotal = $derived(splits.q1 + splits.q2 + splits.q3 + splits.final);
	const isValidSplit = $derived(splitTotal === 100);

	let customMemory: PayoutSplits = { ...DEFAULT_CUSTOM_SPLIT };

	function quarterLabel(quarter: Quarter): string {
		return quarter === 'final' ? 'Final' : quarter.toUpperCase();
	}

	function selectPreset(preset: SplitPreset) {
		if (preset.name !== CUSTOM_PRESET_NAME) {
			if (isCreate && isCustom) customMemory = { ...splits };
			splits = { q1: preset.q1, q2: preset.q2, q3: preset.q3, final: preset.final };
		} else if (isCreate) {
			splits = { ...customMemory };
		}
		selectedPreset = preset.name;
	}
</script>

<div class="grid grid-cols-4 gap-2 {isCreate ? 'mt-3' : 'mb-4'}">
	{#each SPLIT_PRESETS as preset (preset.name)}
		<button
			type="button"
			class="p-2 rounded-lg text-sm font-medium transition-all {selectedPreset === preset.name
				? 'btn-primary'
				: 'btn-secondary'}"
			onclick={() => selectPreset(preset)}
		>
			{preset.name}
		</button>
	{/each}
</div>

{#if isCreate}
	<div class="mt-4 grid grid-cols-4 gap-3">
		{#each QUARTER_KEYS as quarter (quarter)}
			<div class="text-center">
				<label for="split-{quarter}" class="text-xs uppercase block text-muted">
					{quarterLabel(quarter)}
				</label>
				{#if showInputs}
					<input
						id="split-{quarter}"
						type="number"
						bind:value={splits[quarter]}
						min="0"
						max="100"
						class="input mt-1 text-center p-2"
						aria-label="{quarterLabel(quarter)} prize split percentage"
					/>
				{:else}
					<div id="split-{quarter}" class="mt-1 text-lg font-bold">{splits[quarter]}%</div>
				{/if}
			</div>
		{/each}
	</div>

	{#if !isValidSplit}
		<p class="mt-3 text-sm" style="color: #fca5a5">
			Split must total 100% (currently {splitTotal}%)
		</p>
	{/if}
{:else}
	<div class="grid grid-cols-1 gap-3 mb-4">
		{#each QUARTER_KEYS as quarter (quarter)}
			<div>
				<label for="split-{quarter}" class="text-sm text-secondary">{quarterLabel(quarter)}</label>
				<div class="flex items-center gap-1">
					<input
						id="split-{quarter}"
						type="number"
						bind:value={splits[quarter]}
						min="0"
						max="100"
						class="input input-no-spinner mt-1"
						onchange={() => (selectedPreset = CUSTOM_PRESET_NAME)}
					/>
					<span class="text-sm text-secondary">%</span>
				</div>
			</div>
		{/each}
	</div>

	<div class="text-sm mb-4 {isValidSplit ? '' : 'text-red-400'}">
		Total: {splitTotal}% {isValidSplit ? '✓' : '(must be 100%)'}
	</div>
{/if}
