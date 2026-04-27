<script lang="ts">
	import { playerSummary, selectedPlayerFilter } from '$lib/stores/game';
	import PlayerLegend from './PlayerLegend.svelte';

	// Accordion state local to mobile presentation. The first interaction with
	// the toggle or any pill flips `hasInteractedWithPlayers` so the
	// "tap to highlight" hint badge stops showing.
	let isPlayersExpanded = $state(false);
	let hasInteractedWithPlayers = $state(false);

	// Auto-expand when the player roster is small — the value of seeing four
	// players at a glance outweighs the cost of an extra tap on small screens.
	$effect(() => {
		if ($playerSummary.length > 0 && $playerSummary.length <= 4) {
			isPlayersExpanded = true;
		}
	});

	function handleToggle() {
		hasInteractedWithPlayers = true;
		isPlayersExpanded = !isPlayersExpanded;
	}

	function handlePillTap() {
		hasInteractedWithPlayers = true;
	}
</script>

{#if $playerSummary.length > 0}
	<div class="players-section">
		<button
			class="players-toggle"
			class:has-indicator={!hasInteractedWithPlayers && $playerSummary.length > 1}
			onclick={handleToggle}
			aria-expanded={isPlayersExpanded}
		>
			<span class="players-label">
				Players ({$playerSummary.length})
				{#if $selectedPlayerFilter}
					<span class="filter-badge">filtering</span>
				{:else if !hasInteractedWithPlayers && isPlayersExpanded}
					<span class="hint-badge">tap to highlight</span>
				{/if}
			</span>
			<svg
				class="chevron"
				class:expanded={isPlayersExpanded}
				xmlns="http://www.w3.org/2000/svg"
				width="14"
				height="14"
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
				aria-hidden="true"
			>
				<polyline points="6 9 12 15 18 9"></polyline>
			</svg>
		</button>

		{#if isPlayersExpanded}
			<PlayerLegend mode="embedded" onTogglePlayer={handlePillTap} />
		{/if}
	</div>
{/if}

<style>
	.players-section {
		margin-top: 0.5rem;
		border-top: 1px solid var(--border-color);
		padding-top: 0.5rem;
	}

	.players-toggle {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.5rem 0.75rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition: background 200ms;
	}

	.players-toggle:hover {
		background: rgba(255, 255, 255, 0.06);
	}

	.players-toggle.has-indicator {
		background: rgba(100, 170, 230, 0.08);
		border-color: rgba(100, 170, 230, 0.3);
	}

	.players-label {
		font-weight: 500;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.filter-badge {
		font-size: 0.6875rem;
		padding: 0.125rem 0.375rem;
		background: rgba(100, 170, 230, 0.2);
		color: rgba(100, 170, 230, 1);
		border-radius: 4px;
		font-weight: 600;
	}

	.hint-badge {
		font-size: 0.6875rem;
		opacity: 0.7;
		font-style: italic;
	}

	.chevron {
		transition: transform 200ms;
	}

	.chevron.expanded {
		transform: rotate(180deg);
	}

	@media (prefers-reduced-motion: reduce) {
		.chevron,
		.players-toggle {
			transition: none;
		}
	}
</style>
