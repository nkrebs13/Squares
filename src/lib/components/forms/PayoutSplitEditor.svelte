<script lang="ts">
	import { QUARTERS } from '$lib/quarters';
	import {
		CUSTOM_PRESET_NAME,
		findMatchingPresetName,
		isValidSplit,
		presetToSplits,
		splitTotal,
		type PayoutSplits,
	} from '$lib/payouts';
	import type { SplitPreset } from '$lib/types';
	import PayoutPresetButtons from './PayoutPresetButtons.svelte';
	import PayoutPreview from './PayoutPreview.svelte';

	// The prize split: presets, the four percentages, the 100% check and the
	// payout preview. Shared by the create page and the admin payout card.
	interface Props {
		splits: PayoutSplits;
		squarePrice: number;
		/** Prefix for the preview's test ids (`<prefix>-payout-q1`, …). */
		testIdPrefix: string;
	}

	let { splits = $bindable(), squarePrice, testIdPrefix }: Props = $props();

	// "Custom" stays highlighted once picked; otherwise the highlight follows
	// whichever preset the current percentages match, even mid-typing.
	let customPicked = $state(false);
	const highlighted = $derived(customPicked ? CUSTOM_PRESET_NAME : findMatchingPresetName(splits));

	// Hand-entered percentages survive a trip to a preset and back to Custom.
	let customDraft: PayoutSplits | null = null;
	$effect(() => {
		if (highlighted === CUSTOM_PRESET_NAME) customDraft = { ...splits };
	});

	function pick(preset: SplitPreset) {
		customPicked = preset.name === CUSTOM_PRESET_NAME;
		if (!customPicked) splits = presetToSplits(preset);
		else if (customDraft) splits = { ...customDraft };
	}

	const total = $derived(splitTotal(splits));
	const valid = $derived(isValidSplit(splits));
</script>

<PayoutPresetButtons selected={highlighted} onselect={pick} />

<div class="mt-4 grid grid-cols-4 gap-3">
	{#each QUARTERS as { key, short } (key)}
		<label class="block text-center">
			<span class="text-xs uppercase block text-muted">{short}</span>
			<span class="mt-1 flex items-center justify-center gap-1">
				<input
					id="split-{key}"
					type="number"
					bind:value={splits[key]}
					min="0"
					max="100"
					class="input input-no-spinner text-center p-2"
					aria-label="{short} prize split percentage"
				/>
				<span class="text-sm text-secondary">%</span>
			</span>
		</label>
	{/each}
</div>

<p class="mt-3 text-sm {valid ? 'text-secondary' : 'text-error'}">
	Total: {total}% {valid ? '✓' : '(must be 100%)'}
</p>

<PayoutPreview {splits} {squarePrice} {testIdPrefix} class="mt-4" />
