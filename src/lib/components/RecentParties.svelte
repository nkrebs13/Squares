<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getRecentParties, removeRecentParty } from '$lib/storage';
	import type { RecentParty } from '$lib/types';

	let recentParties = $state<RecentParty[]>([]);
	let isLoading = $state(true);

	onMount(async () => {
		recentParties = await getRecentParties();
		// Show only top 5
		recentParties = recentParties.slice(0, 5);
		isLoading = false;
	});

	function getStatusBadge(status: string) {
		switch (status) {
			case 'filling':
				return { text: 'Filling', class: 'badge-filling' };
			case 'locked':
				return { text: 'Locked', class: 'badge-locked' };
			case 'active':
				return { text: 'Live', class: 'badge-active' };
			case 'complete':
				return { text: 'Done', class: 'badge-complete' };
			default:
				return { text: status, class: '' };
		}
	}

	function handlePartyClick(code: string) {
		goto(`/party/${code}`);
	}

	async function handleRemove(e: Event, code: string) {
		e.stopPropagation();
		await removeRecentParty(code);
		recentParties = recentParties.filter((p) => p.code !== code);
	}
</script>

{#if !isLoading && recentParties.length > 0}
	<div class="recent-parties">
		<h3 class="recent-title">Recent Parties</h3>
		<div class="party-list">
			{#each recentParties as party}
				{@const badge = getStatusBadge(party.status)}
				<div
					class="party-card"
					role="button"
					tabindex="0"
					onclick={() => handlePartyClick(party.code)}
					onkeydown={(e) => e.key === 'Enter' && handlePartyClick(party.code)}
				>
					<div class="party-info">
						<div class="party-code">{party.code}</div>
					</div>
					<div class="party-meta">
						{#if party.isHost}
							<span class="host-badge">Host</span>
						{/if}
						<span class="status-badge {badge.class}">{badge.text}</span>
						<button
							class="remove-btn"
							onclick={(e) => handleRemove(e, party.code)}
							aria-label="Remove from recent"
						>
							<svg
								xmlns="http://www.w3.org/2000/svg"
								width="16"
								height="16"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								stroke-linejoin="round"
							>
								<line x1="18" y1="6" x2="6" y2="18"></line>
								<line x1="6" y1="6" x2="18" y2="18"></line>
							</svg>
						</button>
					</div>
				</div>
			{/each}
		</div>
	</div>
{/if}

<style>
	.recent-parties {
		margin-top: 2rem;
		width: 100%;
		max-width: 24rem;
	}

	.recent-title {
		font-size: 0.875rem;
		font-weight: 500;
		color: var(--text-muted);
		margin-bottom: 0.75rem;
		text-align: center;
	}

	.party-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}

	.party-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		cursor: pointer;
		transition: all 200ms ease;
		text-align: left;
		width: 100%;
		outline: none;
	}

	.party-card:focus-visible {
		border-color: rgba(100, 210, 200, 0.5);
		box-shadow: 0 0 0 2px rgba(100, 210, 200, 0.2);
	}

	.party-card:hover {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(100, 210, 200, 0.3);
	}

	.party-card:active {
		transform: scale(0.98);
	}

	.party-info {
		display: flex;
		flex-direction: column;
		gap: 0.125rem;
	}

	.party-code {
		font-family: monospace;
		font-weight: 600;
		font-size: 0.875rem;
		color: var(--text-primary);
		letter-spacing: 0.1em;
	}

	.party-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.host-badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
		background: rgba(244, 143, 177, 0.2);
		color: var(--color-accent);
		border: 1px solid rgba(244, 143, 177, 0.3);
	}

	.status-badge {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		padding: 0.125rem 0.375rem;
		border-radius: 4px;
	}

	.badge-filling {
		background: rgba(244, 143, 177, 0.15);
		color: var(--color-accent);
	}

	.badge-locked {
		background: rgba(255, 183, 77, 0.15);
		color: var(--color-warning);
	}

	.badge-active {
		background: rgba(100, 200, 130, 0.15);
		color: var(--color-success);
	}

	.badge-complete {
		background: rgba(148, 163, 184, 0.15);
		color: var(--text-secondary);
	}

	.remove-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		padding: 0;
		background: transparent;
		border: none;
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		opacity: 0.5;
		transition: all 200ms ease;
	}

	.remove-btn:hover {
		opacity: 1;
		background: rgba(255, 255, 255, 0.1);
		color: var(--text-primary);
	}
</style>
