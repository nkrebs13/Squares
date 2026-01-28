<script lang="ts">
	import { mySquareCount, amountOwed, party } from '$lib/stores/game';
	import { userName } from '$lib/stores/user';

	function formatAmount(amount: number): string {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
		}).format(amount);
	}
</script>

{#if $userName}
	<div class="card">
		<div class="flex justify-between items-center">
			<div>
				<div class="text-sm" style="color: var(--text-secondary)">Playing as</div>
				<div class="font-semibold">{$userName}</div>
			</div>

			<div class="text-right">
				<div class="text-sm" style="color: var(--text-secondary)">Squares owned</div>
				<div class="font-semibold">{$mySquareCount}</div>
			</div>

			{#if $party && $party.square_price > 0}
				<div class="text-right">
					<div class="text-sm" style="color: var(--text-secondary)">Amount owed</div>
					<div class="font-semibold" style="color: var(--color-warning)">
						{formatAmount($amountOwed)}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
