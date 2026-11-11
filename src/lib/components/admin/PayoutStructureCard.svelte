<script lang="ts">
	import { updatePayoutStructure } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import type { Party } from '$lib/types';
	import { isValidSplit, type PayoutSplits } from '$lib/payouts';
	import PayoutSplitEditor from '$lib/components/forms/PayoutSplitEditor.svelte';

	interface Props {
		party: Party;
		storedPin: string;
	}

	const { party, storedPin }: Props = $props();

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
	let isUpdatingPayout = $state(false);

	const isValid = $derived(isValidSplit(payoutSplits));

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

	<div class="mb-4">
		<PayoutSplitEditor
			bind:splits={payoutSplits}
			squarePrice={party.square_price}
			testIdPrefix="admin"
		/>
	</div>

	<button
		onclick={handleSave}
		class="btn btn-primary w-full"
		disabled={isUpdatingPayout || !isValid}
	>
		{isUpdatingPayout ? 'Saving...' : 'Save Payout Structure'}
	</button>
</div>
