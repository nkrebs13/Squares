<script lang="ts">
	import { playerSummary, availableCount, party, selectedPlayerFilter } from '$lib/stores/game';
	import { getPlayerColor } from '$lib/utils/colors';

	interface Props {
		// 'block' (default): renders the full Players section with header. Used in
		//   the desktop sidebar (PartySidebar variant=desktop).
		// 'embedded': renders only the pill grid, no surrounding chrome. Used by
		//   MobilePlayerFilter inside its accordion shell.
		mode?: 'block' | 'embedded';
		onTogglePlayer?: (normalizedName: string) => void;
	}

	const { mode = 'block', onTogglePlayer }: Props = $props();

	function togglePlayerFilter(normalizedName: string) {
		onTogglePlayer?.(normalizedName);
		selectedPlayerFilter.update((current) => (current === normalizedName ? null : normalizedName));
	}
</script>

{#snippet pills()}
	{#each $playerSummary as player (player.normalizedName)}
		{@const color = getPlayerColor(player.name)}
		<button
			class="player-pill"
			class:selected={$selectedPlayerFilter === player.normalizedName}
			style="--player-bg: {color.bg}; --player-text: {color.text};"
			onclick={() => togglePlayerFilter(player.normalizedName)}
		>
			<div class="player-dot" style="background: {color.text};"></div>
			<span class="player-name">{player.name}</span>
			<span class="player-count">{player.count}</span>
		</button>
	{/each}
	{#if $party?.status === 'filling' && $availableCount > 0}
		<div class="available-count">
			{$availableCount} squares available
		</div>
	{/if}
{/snippet}

{#if $playerSummary.length > 0}
	{#if mode === 'block'}
		<div class="players-legend">
			<h3 class="font-medium mb-3" style="color: var(--text-secondary)">Players</h3>
			<div class="players-grid">
				{@render pills()}
			</div>
		</div>
	{:else}
		<div class="players-grid">
			{@render pills()}
		</div>
	{/if}
{/if}

<style>
	.players-legend {
		padding: 0.75rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 12px;
		border: 1px solid var(--border-color);
	}

	.players-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 0.5rem;
	}

	.player-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem 0.625rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
		min-height: 40px;
		width: 100%;
	}

	.player-pill:hover {
		background: rgba(255, 255, 255, 0.06);
		transform: translateY(-1px);
	}

	.player-pill.selected {
		background: var(--player-bg);
		border-color: var(--player-text);
		box-shadow: 0 0 12px color-mix(in srgb, var(--player-text) 30%, transparent);
	}

	.player-pill.selected .player-name,
	.player-pill.selected .player-count {
		color: var(--player-text);
		font-weight: 600;
	}

	.player-pill:active {
		transform: scale(0.97);
	}

	.player-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.player-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		text-align: left;
	}

	.player-count {
		font-weight: 600;
		opacity: 0.8;
	}

	.available-count {
		grid-column: 1 / -1;
		text-align: center;
		padding: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-secondary);
		opacity: 0.7;
	}

	/* Reduced motion support */
	@media (prefers-reduced-motion: reduce) {
		.player-pill {
			transition: none;
		}
	}
</style>
