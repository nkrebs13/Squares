<script lang="ts">
	import { updatePayoutStructure } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import type { Party, Quarter, SplitPreset } from '$lib/types';
	import {
		CUSTOM_PRESET_NAME,
		findMatchingPresetName,
		isValidSplit,
		presetToSplits,
		splitTotal,
		type PayoutSplits,
	} from '$lib/payouts';
	import PayoutPresetButtons from '$lib/components/forms/PayoutPresetButtons.svelte';
	import PayoutPreview from '$lib/components/forms/PayoutPreview.svelte';

	interface Props {
		party: Party;
		storedPin: string;
	}

	const { party, storedPin }: Props = $props();

	const QUARTERS: { key: Quarter; label: string }[] = [
		{ key: 'q1', label: 'Q1' },
		{ key: 'q2', label: 'Q2' },
		{ key: 'q3', label: 'Q3' },
		{ key: 'final', label: 'Final' },
	];

	// Initialized from the party once. A realtime party update must NOT clobber
	// the host's unsaved edits, so these never re-derive from `party`.
	function initialSplits(): PayoutSplits {
		return {
			q1: party.split_q1,
			q2: party.split_q2,
			q3: party.split_q3,
			final: party.split_final,
		};
	}

	let payoutSplits = $state<PayoutSplits>(initialSplits());
	let selectedPreset = $state(findMatchingPresetName(initialSplits()));
	let isUpdatingPayout = $state(false);

	const isValid = $derived(isValidSplit(payoutSplits));
	const total = $derived(splitTotal(payoutSplits));

	function selectPreset(preset: SplitPreset) {
		if (preset.name !== CUSTOM_PRESET_NAME) payoutSplits = presetToSplits(preset);
		selectedPreset = preset.name;
	}

	async function handleSave() {
		isUpdatingPayout = true;

		const result = await updatePayoutStructure(storedPin, payoutSplits);

		if (result.success) {
			toast.success('Payout structure updated!');
		} else {
			toast.error(result.error || 'Failed to update payout structure');
		}

		isUpdatingPayout = false;
	}
</script>

<div class="card">
	<h2 class="text-lg font-semibold mb-4">Payout Structure</h2>
	<p class="text-sm mb-4 text-secondary">
		Adjust how the pot is split between quarters. Must total 100%.
	</p>

	<PayoutPresetButtons selected={selectedPreset} onselect={selectPreset} class="mb-4" />

	<div class="grid grid-cols-1 gap-3 mb-4">
		{#each QUARTERS as { key, label } (key)}
			<div>
				<label for="split-{key}" class="text-sm text-secondary">{label}</label>
				<div class="flex items-center gap-1">
					<input
						id="split-{key}"
						type="number"
						bind:value={payoutSplits[key]}
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

	<div class="text-sm mb-4 {isValid ? '' : 'text-red-400'}">
		Total: {total}% {isValid ? '✓' : '(must be 100%)'}
	</div>

	<PayoutPreview
		splits={payoutSplits}
		squarePrice={party.square_price}
		testIdPrefix="admin"
		class="mb-4"
	/>

	<button
		onclick={handleSave}
		class="btn btn-primary w-full"
		disabled={isUpdatingPayout || !isValid}
	>
		{isUpdatingPayout ? 'Saving...' : 'Save Payout Structure'}
	</button>
</div>
