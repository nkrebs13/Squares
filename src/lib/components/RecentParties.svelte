<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { goto } from '$app/navigation';
	import { getRecentParties, removeRecentParty, updatePartyNickname } from '$lib/storage';
	import type { RecentParty } from '$lib/types';

	const MAX_NICKNAME_LENGTH = 30;

	let recentParties = $state<RecentParty[]>([]);
	let isLoading = $state(true);
	let editingCode = $state<string | null>(null);
	let editValue = $state('');
	let inputElement = $state<HTMLInputElement | null>(null);
	let blurTimeoutId: ReturnType<typeof setTimeout> | null = null;

	onMount(async () => {
		recentParties = await getRecentParties();
		// Show only top 5
		recentParties = recentParties.slice(0, 5);
		isLoading = false;
	});

	onDestroy(() => {
		if (blurTimeoutId) {
			clearTimeout(blurTimeoutId);
		}
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

	function getDisplayName(party: RecentParty): string {
		if (party.nickname) {
			return party.nickname;
		}
		// Fallback to team matchup
		return `${party.teamRowName} vs ${party.teamColName}`;
	}

	function handlePartyClick(code: string) {
		// Don't navigate if we're editing
		if (editingCode) return;
		goto(`/party/${code}`);
	}

	async function handleRemove(e: Event, code: string) {
		e.stopPropagation();
		await removeRecentParty(code);
		recentParties = recentParties.filter((p) => p.code !== code);
	}

	async function startEdit(e: Event, party: RecentParty) {
		e.stopPropagation();
		editingCode = party.code;
		editValue = party.nickname || '';
		await tick();
		inputElement?.focus();
		inputElement?.select();
	}

	async function saveEdit() {
		if (!editingCode) return;

		const code = editingCode;
		const trimmed = editValue.trim();

		// Update local state immediately
		recentParties = recentParties.map((p) =>
			p.code === code ? { ...p, nickname: trimmed || undefined } : p
		);

		// Save to storage
		await updatePartyNickname(code, trimmed);

		editingCode = null;
		editValue = '';
	}

	function cancelEdit() {
		editingCode = null;
		editValue = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			saveEdit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			cancelEdit();
		}
	}

	function handleBlur() {
		// Capture current editing code to prevent race condition when switching between edits
		const codeBeingEdited = editingCode;

		// Clear any existing timeout
		if (blurTimeoutId) {
			clearTimeout(blurTimeoutId);
		}

		// Small delay to allow button clicks to register
		blurTimeoutId = setTimeout(() => {
			blurTimeoutId = null;
			// Only save if we're still editing the same party
			if (editingCode && editingCode === codeBeingEdited) {
				saveEdit();
			}
		}, 100);
	}
</script>

{#if !isLoading && recentParties.length > 0}
	<div class="recent-parties">
		<h3 class="recent-title">Recent Parties</h3>
		<div class="party-list">
			{#each recentParties as party (party.code)}
				{@const badge = getStatusBadge(party.status)}
				{@const isEditing = editingCode === party.code}
				<div
					class="party-card"
					role="button"
					tabindex="0"
					onclick={() => handlePartyClick(party.code)}
					onkeydown={(e) => e.key === 'Enter' && !isEditing && handlePartyClick(party.code)}
				>
					<div class="party-info">
						{#if isEditing}
							<input
								bind:this={inputElement}
								type="text"
								class="nickname-input"
								bind:value={editValue}
								maxlength={MAX_NICKNAME_LENGTH}
								placeholder="Add a nickname..."
								aria-label="Party nickname"
								onkeydown={handleKeydown}
								onblur={handleBlur}
								onclick={(e) => e.stopPropagation()}
							/>
						{:else}
							<button
								class="nickname-text"
								onclick={(e) => startEdit(e, party)}
								aria-label={party.nickname ? `Edit nickname: ${party.nickname}` : 'Add nickname'}
							>
								<span class="nickname-label">{getDisplayName(party)}</span>
								<svg
									class="edit-icon"
									xmlns="http://www.w3.org/2000/svg"
									width="14"
									height="14"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
								>
									<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
									<path d="m15 5 4 4" />
								</svg>
							</button>
						{/if}
						<div class="party-code-line">
							<span class="party-code-small">{party.code}</span>
							{#if party.isHost}
								<span class="separator">•</span>
								<span class="host-badge-inline">Host</span>
							{/if}
						</div>
					</div>
					<div class="party-meta">
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
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
	}

	/* Nickname display button */
	.nickname-text {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		background: transparent;
		border: none;
		padding: 0;
		cursor: pointer;
		text-align: left;
		color: var(--text-primary);
		transition: color 150ms ease;
		max-width: 100%;
	}

	.nickname-text:hover {
		color: rgba(100, 210, 200, 0.9);
	}

	.nickname-text:focus-visible {
		outline: 2px solid rgba(100, 210, 200, 0.5);
		outline-offset: 2px;
		border-radius: 4px;
	}

	.nickname-label {
		font-weight: 600;
		font-size: 0.9375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.edit-icon {
		flex-shrink: 0;
		opacity: 0.4;
		transition: opacity 150ms ease;
	}

	/* Desktop: hide icon until hover */
	@media (min-width: 768px) {
		.edit-icon {
			opacity: 0;
		}

		.nickname-text:hover .edit-icon,
		.nickname-text:focus .edit-icon {
			opacity: 0.6;
		}
	}

	/* Inline edit input */
	.nickname-input {
		font-weight: 600;
		font-size: 0.9375rem;
		color: var(--text-primary);
		background: rgba(255, 255, 255, 0.05);
		border: 1px solid rgba(100, 210, 200, 0.4);
		border-radius: 6px;
		padding: 0.25rem 0.5rem;
		width: 100%;
		max-width: 180px;
		font-family: inherit;
	}

	.nickname-input:focus {
		outline: none;
		border-color: rgba(100, 210, 200, 0.6);
		box-shadow: 0 0 0 3px rgba(100, 210, 200, 0.15);
	}

	.nickname-input::placeholder {
		color: var(--text-muted);
		font-weight: 400;
	}

	/* Secondary code line */
	.party-code-line {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.party-code-small {
		font-family: monospace;
		font-size: 0.75rem;
		color: var(--text-muted);
		letter-spacing: 0.05em;
	}

	.separator {
		color: var(--text-muted);
		font-size: 0.625rem;
	}

	.host-badge-inline {
		font-size: 0.625rem;
		font-weight: 600;
		text-transform: uppercase;
		color: var(--color-accent);
	}

	.party-meta {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		flex-shrink: 0;
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
