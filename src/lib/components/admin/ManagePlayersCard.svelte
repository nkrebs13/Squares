<script lang="ts">
	import { plural } from '$lib/utils/format';
	import { playerSummary, type PlayerSummary } from '$lib/stores/game';

	interface Props {
		hostNameLower: string | null;
		onremove: (player: PlayerSummary) => void;
	}

	const { hostNameLower, onremove }: Props = $props();
</script>

{#if $playerSummary.length > 0}
	<div class="card">
		<h2 class="text-lg font-semibold mb-4">Manage Players</h2>
		<p class="text-sm mb-4 text-secondary">
			Remove a player to free up their squares for others to claim.
		</p>

		<div class="space-y-2">
			{#each $playerSummary as player (player.normalizedName)}
				<div
					class="flex items-center justify-between p-3 rounded-lg"
					style="background: rgba(255, 255, 255, 0.04);"
				>
					<div>
						<div class="font-medium">
							{player.name}
							{#if player.normalizedName === hostNameLower}
								<span class="text-xs ml-1 text-muted">(host)</span>
							{/if}
						</div>
						<div class="text-sm text-secondary">
							{plural(player.count, 'square', 'squares')}
						</div>
					</div>
					{#if player.normalizedName !== hostNameLower}
						<button onclick={() => onremove(player)} class="btn btn-sm btn-danger-soft">
							Remove
						</button>
					{/if}
				</div>
			{/each}
		</div>
	</div>
{/if}
