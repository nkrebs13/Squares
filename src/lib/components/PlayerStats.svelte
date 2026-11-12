<script lang="ts">
	import { mySquareCount, amountOwed, party } from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import { formatPrice } from '$lib/utils/format';
</script>

{#if $userName}
	<div class="card">
		<div class="flex justify-between items-center">
			<div>
				<div class="text-sm text-secondary">Playing as</div>
				<div class="font-semibold">{$userName}</div>
			</div>

			<div class="text-right">
				<div class="text-sm text-secondary">Squares owned</div>
				<div class="font-semibold">{$mySquareCount}</div>
			</div>

			{#if $party}
				<div class="text-right">
					<div class="text-sm text-secondary">Amount owed</div>
					<div class="font-semibold" style="color: var(--color-warning)">
						{formatPrice($amountOwed)}
					</div>
				</div>
			{/if}
		</div>
	</div>
{/if}
