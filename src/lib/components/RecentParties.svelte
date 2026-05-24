<script lang="ts">
	import { onMount, onDestroy, tick } from 'svelte';
	import { getRecentParties, removeRecentParty, updatePartyNickname } from '$lib/storage';
	import { formatKickoff } from '$lib/utils/datetime';
	import type { RecentParty, PartyStatus } from '$lib/types';

	const MAX_NICKNAME_LENGTH = 30;

	let recentParties = $state<RecentParty[]>([]);
	let isLoading = $state(true);
	let editingCode = $state<string | null>(null);
	let editValue = $state('');
	let inputElement = $state<HTMLInputElement | null>(null);
	let blurTimeoutId: ReturnType<typeof setTimeout> | null = null;
	let confirmingRemoveCode = $state<string | null>(null);

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

	function getStatusBadge(status: PartyStatus) {
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
		return party.eventName || `${party.teamRowName} vs ${party.teamColName}`;
	}

	function getDetailLine(party: RecentParty): string {
		const matchup = `${party.teamRowName} vs ${party.teamColName}`;
		if (!party.nickname && (!party.eventName || party.eventName === matchup)) return '';
		if (party.nickname && (!party.eventName || party.eventName === matchup)) return matchup;
		if (!party.kickoffAt) return matchup;

		const kickoff = formatKickoff(party.kickoffAt);
		return kickoff ? `${matchup} - ${kickoff}` : matchup;
	}

	function handleRemove(e: Event, code: string) {
		e.stopPropagation();
		confirmingRemoveCode = code;
	}

	async function confirmRemove(e: Event, code: string) {
		e.stopPropagation();
		await removeRecentParty(code);
		recentParties = recentParties.filter((p) => p.code !== code);
		confirmingRemoveCode = null;
	}

	function cancelRemove(e: Event) {
		e.stopPropagation();
		confirmingRemoveCode = null;
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
				{@const badge = getStatusBadge(party.status)}
				{@const isEditing = editingCode === party.code}
				{@const detailLine = getDetailLine(party)}
				<article class="party-card">
					<a
						class="card-nav-link"
						href="/party/{party.code}"
						data-sveltekit-reload
						aria-label="Open {getDisplayName(party)}"
						onclick={(e) => {
							if (isEditing) e.preventDefault();
						}}
					></a>
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
							<span class="nickname-text">
								<span class="nickname-label">{getDisplayName(party)}</span>
								<button
									class="edit-btn"
									onclick={(e) => startEdit(e, party)}
									aria-label={party.nickname ? `Edit nickname: ${party.nickname}` : 'Add nickname'}
								>
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
							</span>
						{/if}
						<div class="party-code-line">
							<span class="party-code-small">{party.code}</span>
							{#if detailLine}
								<span class="separator">•</span>
								<span class="party-detail-small">{detailLine}</span>
							{/if}
							{#if party.isHost}
								<span class="separator">•</span>
								<span class="host-badge-inline">Host</span>
							{/if}
						</div>
					</div>
					<div class="party-meta">
						{#if confirmingRemoveCode === party.code}
							<div class="confirm-remove">
								<span class="confirm-label">Remove?</span>
								<button
									class="confirm-yes-btn"
									onclick={(e) => confirmRemove(e, party.code)}
									aria-label="Confirm remove"
								>
									Yes
								</button>
								<button class="confirm-no-btn" onclick={cancelRemove} aria-label="Cancel remove">
									No
								</button>
							</div>
						{:else}
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
						{/if}
					</div>
				</article>
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

	.party-card {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0.75rem 1rem;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 12px;
		transition: all 200ms ease;
		position: relative;
	}

	.party-card:has(.card-nav-link:hover) {
		background: rgba(255, 255, 255, 0.05);
		border-color: rgba(100, 210, 200, 0.3);
	}

	.party-card:has(.card-nav-link:active) {
		transform: scale(0.98);
	}

	/* Stretched link covers the full card clickable area */
	.card-nav-link {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		z-index: 1;
	}

	.card-nav-link:focus-visible {
		outline: 2px solid rgba(100, 210, 200, 0.9);
		outline-offset: 2px;
		box-shadow: 0 0 0 4px rgba(100, 210, 200, 0.2);
	}

	.party-info {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		flex: 1;
		min-width: 0;
		pointer-events: none;
	}

	/* Nickname display */
	.nickname-text {
		display: inline-flex;
		align-items: center;
		gap: 0.375rem;
		color: var(--text-primary);
		max-width: 100%;
	}

	.nickname-label {
		font-weight: 600;
		font-size: 0.9375rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	/* Edit button (pencil icon only) */
	.edit-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		padding: 0.25rem;
		margin: -0.25rem;
		cursor: pointer;
		color: inherit;
		border-radius: 4px;
		flex-shrink: 0;
	}

	.edit-btn:hover {
		color: rgba(100, 210, 200, 0.9);
	}

	.edit-btn:focus-visible {
		outline: 2px solid rgba(100, 210, 200, 0.5);
		outline-offset: 2px;
	}

	/* Keep interactive elements above the stretched nav link */
	.edit-btn,
	.remove-btn,
	.confirm-remove,
	.nickname-input {
		position: relative;
		z-index: 2;
		pointer-events: auto;
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

		.party-card:has(.card-nav-link:hover) .edit-icon,
		.party-card:hover .edit-icon {
			opacity: 0.6;
		}

		.edit-btn:hover .edit-icon,
		.edit-btn:focus .edit-icon {
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

	.party-detail-small {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--text-muted);
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
		pointer-events: none;
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

	/* Confirmation inline UI */
	.confirm-remove {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.confirm-label {
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		white-space: nowrap;
	}

	.confirm-yes-btn,
	.confirm-no-btn {
		font-size: 0.6875rem;
		font-weight: 600;
		padding: 0.125rem 0.5rem;
		border-radius: 4px;
		border: none;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.confirm-yes-btn {
		background: rgba(239, 68, 68, 0.15);
		color: #ef4444;
	}

	.confirm-yes-btn:hover {
		background: rgba(239, 68, 68, 0.3);
	}

	.confirm-no-btn {
		background: rgba(148, 163, 184, 0.15);
		color: var(--text-secondary);
	}

	.confirm-no-btn:hover {
		background: rgba(148, 163, 184, 0.3);
	}
</style>
