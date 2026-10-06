<script lang="ts">
	import { buildPayoutRows, calculateTotalPot, type PayoutSplits } from '$lib/payouts';
	import { formatPrice } from '$lib/utils/format';

	interface Props {
		splits: PayoutSplits;
		squarePrice: number;
		/** Prefix for data-testids: `{testIdPrefix}-payout-preview` and `{testIdPrefix}-payout-{quarter}`. */
		testIdPrefix: string;
		class?: string;
	}

	const { splits, squarePrice, testIdPrefix, class: className = '' }: Props = $props();

	const totalPot = $derived(calculateTotalPot(squarePrice));
	const rows = $derived(buildPayoutRows(splits, totalPot));
</script>

<div
	class="rounded-lg border p-3 {className}"
	style="border-color: rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.03);"
	data-testid="{testIdPrefix}-payout-preview"
>
	<div class="flex items-center justify-between gap-3">
		<span class="text-sm font-medium">Payout preview</span>
		<span class="text-sm text-secondary">Pot {formatPrice(totalPot)}</span>
	</div>
	<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
		{#each rows as row (row.key)}
			<div data-testid={`${testIdPrefix}-payout-${row.key}`}>
				<div class="text-xs uppercase text-muted">{row.label}</div>
				<div class="font-semibold">{formatPrice(row.amount)}</div>
				<div class="text-xs text-secondary">{row.percent}%</div>
			</div>
		{/each}
	</div>
</div>
