<script lang="ts">
	import { onMount } from 'svelte';
	import { getRecentParties, removeRecentParty, updatePartyNickname } from '$lib/storage';
	import RecentPartyRow from './RecentPartyRow.svelte';
	import type { RecentParty } from '$lib/types';

	let recentParties = $state<RecentParty[]>([]);
	let isLoading = $state(true);
	let confirmingRemoveCode = $state<string | null>(null);

	onMount(async () => {
		recentParties = await getRecentParties();
		// Show only top 5
		recentParties = recentParties.slice(0, 5);
		isLoading = false;
	});

	async function confirmRemove(code: string) {
		await removeRecentParty(code);
		recentParties = recentParties.filter((p) => p.code !== code);
		confirmingRemoveCode = null;
	}

	async function saveNickname(code: string, trimmed: string) {
		// Update local state immediately
		recentParties = recentParties.map((p) =>
			p.code === code ? { ...p, nickname: trimmed || undefined } : p
		);

		// Save to storage
		await updatePartyNickname(code, trimmed);
	}
</script>

{#if !isLoading && recentParties.length === 0}
	<div class="recent-parties recent-parties-empty">
		<h3 class="recent-title">Recent Parties</h3>
		<p class="empty-message">
			No recent parties yet — <a href="/create" class="empty-link">create one</a> to get started, or join
			with a code.
		</p>
	</div>
{:else if !isLoading && recentParties.length > 0}
	<div class="recent-parties">
		<h3 class="recent-title">Recent Parties</h3>
		<div class="party-list">
			{#each recentParties as party (party.code)}
				<RecentPartyRow
					{party}
					confirmingRemove={confirmingRemoveCode === party.code}
					onsavenickname={saveNickname}
					onrequestremove={(code) => (confirmingRemoveCode = code)}
					onconfirmremove={confirmRemove}
					oncancelremove={() => (confirmingRemoveCode = null)}
				/>
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

	.empty-message {
		text-align: center;
		font-size: 0.875rem;
		color: var(--text-secondary);
		padding: 1.5rem 1rem;
		background: rgba(255, 255, 255, 0.03);
		border: 1px dashed var(--border-color);
		border-radius: 12px;
	}

	.empty-link {
		color: rgba(100, 210, 200, 0.95);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.empty-link:hover {
		color: rgba(100, 210, 200, 1);
	}

	.party-list {
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
	}
</style>
