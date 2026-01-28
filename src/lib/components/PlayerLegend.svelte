<script lang="ts">
	import { playerSummary, availableCount, party, selectedPlayerFilter } from '$lib/stores/game';

	// Player colors (same as Square.svelte)
	const playerColors = [
		{ bg: 'rgba(100, 180, 255, 0.22)', text: 'rgba(120, 190, 255, 0.95)' },
		{ bg: 'rgba(255, 110, 110, 0.22)', text: 'rgba(255, 130, 130, 0.95)' },
		{ bg: 'rgba(100, 230, 100, 0.22)', text: 'rgba(120, 240, 120, 0.95)' },
		{ bg: 'rgba(255, 230, 100, 0.22)', text: 'rgba(255, 235, 130, 0.98)' },
		{ bg: 'rgba(180, 100, 255, 0.22)', text: 'rgba(190, 120, 255, 0.95)' },
		{ bg: 'rgba(255, 150, 80, 0.22)', text: 'rgba(255, 170, 110, 0.98)' },
		{ bg: 'rgba(100, 230, 230, 0.22)', text: 'rgba(120, 240, 240, 0.95)' },
		{ bg: 'rgba(255, 100, 170, 0.22)', text: 'rgba(255, 130, 185, 0.95)' },
		{ bg: 'rgba(190, 255, 100, 0.22)', text: 'rgba(200, 255, 130, 0.98)' },
		{ bg: 'rgba(255, 130, 220, 0.22)', text: 'rgba(255, 150, 230, 0.95)' },
		{ bg: 'rgba(100, 255, 190, 0.22)', text: 'rgba(120, 255, 200, 0.95)' },
		{ bg: 'rgba(230, 190, 150, 0.22)', text: 'rgba(245, 210, 175, 0.98)' },
		{ bg: 'rgba(130, 200, 200, 0.22)', text: 'rgba(150, 220, 220, 0.95)' },
		{ bg: 'rgba(200, 160, 255, 0.22)', text: 'rgba(210, 175, 255, 0.95)' },
		{ bg: 'rgba(255, 200, 150, 0.22)', text: 'rgba(255, 215, 175, 0.98)' },
	];

	function getPlayerColor(name: string): { bg: string; text: string } {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return playerColors[Math.abs(hash) % playerColors.length];
	}

	// Toggle player filter
	function togglePlayerFilter(normalizedName: string) {
		selectedPlayerFilter.update((current) => (current === normalizedName ? null : normalizedName));
	}
</script>

{#if $playerSummary.length > 0}
	<div class="players-legend">
		<h3 class="font-medium mb-3" style="color: var(--text-secondary)">Players</h3>
		<div class="players-grid">
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
		</div>
	</div>
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
