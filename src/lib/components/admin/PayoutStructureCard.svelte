<script lang="ts">
	import { updatePayoutStructure } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import { SPLIT_PRESETS, type Party } from '$lib/types';
	import type { PayoutSplits } from '$lib/payouts';
	import PayoutSplitEditor from '$lib/components/forms/PayoutSplitEditor.svelte';
	import PayoutPreview from '$lib/components/forms/PayoutPreview.svelte';

	interface Props {
		party: Party;
		storedPin: string;
	}

	const { party, storedPin }: Props = $props();

	const DEFAULT_PRESET = SPLIT_PRESETS[0];

	let payoutSplits = $state<PayoutSplits>({
		q1: DEFAULT_PRESET.q1,
		q2: DEFAULT_PRESET.q2,
		q3: DEFAULT_PRESET.q3,
		final: DEFAULT_PRESET.final,
	});
	let selectedPreset = $state(DEFAULT_PRESET.name);
	let isUpdatingPayout = $state(false);

	// Initialize from party data once. After the user starts editing (via inputs
	// or preset buttons), a realtime party update should NOT clobber their
	// unsaved work.
	let initialized = $state(false);
	$effect(() => {
		if (!initialized) {
			payoutSplits = {
				q1: party.split_q1,
				q2: party.split_q2,
				q3: party.split_q3,
				final: party.split_final,
			};
			initialized = true;
		}
	});

	const splitTotal = $derived(
		payoutSplits.q1 + payoutSplits.q2 + payoutSplits.q3 + payoutSplits.final
	);

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

	<PayoutSplitEditor bind:splits={payoutSplits} bind:selectedPreset variant="admin" />

	<PayoutPreview
		splits={payoutSplits}
		squarePrice={party.square_price}
		testIdPrefix="admin"
		class="mb-4"
	/>

	<button
		onclick={handleSave}
		class="btn btn-primary w-full"
		disabled={isUpdatingPayout || splitTotal !== 100}
	>
		{isUpdatingPayout ? 'Saving...' : 'Save Payout Structure'}
	</button>
</div>
