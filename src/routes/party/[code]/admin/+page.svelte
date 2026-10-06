<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import {
		partyPinKey,
		getHostPin,
		getSessionItem,
		removeHostPin,
		removeSessionItem,
		removeRecentParty,
	} from '$lib/storage';
	import {
		party,
		filledCount,
		isLoading,
		error as partyLoadError,
		loadParty,
		deleteParty,
		removePlayer,
		subscribeToParty,
		cleanup,
	} from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import { isGameInProgress } from '$lib/types';
	import { goto } from '$app/navigation';
	import PinGate from '$lib/components/admin/PinGate.svelte';
	import EventDetailsCard from '$lib/components/admin/EventDetailsCard.svelte';
	import ManagePlayersCard from '$lib/components/admin/ManagePlayersCard.svelte';
	import PayoutStructureCard from '$lib/components/admin/PayoutStructureCard.svelte';
	import LockGridCard from '$lib/components/admin/LockGridCard.svelte';
	import LiveScoresPanel from '$lib/components/admin/LiveScoresPanel.svelte';
	import ScoreEntryCard from '$lib/components/admin/ScoreEntryCard.svelte';
	import DangerZoneCard from '$lib/components/admin/DangerZoneCard.svelte';
	import ConfirmDialog from '$lib/components/forms/ConfirmDialog.svelte';

	const code = $derived($page.params.code ?? '');
	let storedPin = $state<string | null>(null);
	let showManualOverride = $state(false);

	// Delete confirmation
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);

	// Player removal
	let playerToRemove = $state<{ name: string; normalizedName: string; count: number } | null>(null);
	let isRemovingPlayer = $state(false);
	// Set right before `playerToRemove = null` on a successful removal (see
	// handleRemovePlayer). Distinguishes "closed because the removal
	// succeeded" from "closed via Cancel/Escape" so the dialog knows whether
	// the element that opened it is still safe to focus.
	let removePlayerSucceeded = false;
	// Always-rendered heading (see the "Party Status" <h2> in the template)
	// used as the focus target on a successful removal. The removed
	// player's row — and, when it was the last player, the whole "Manage
	// Players" card — is gone from the DOM by the time this runs, so the
	// trigger button is detached and `.focus()` on it would silently drop
	// focus to <body>. "Party Status" is rendered for every party status
	// whenever $party is set, so it survives regardless of how many players
	// remain after the removal.
	// $state: bound inside the `{:else if $party}` branch (not always
	// mounted — e.g. absent during PIN entry / loading).
	let partyStatusHeadingEl = $state<HTMLHeadingElement | null>(null);

	let unsubscribe: (() => void) | null = null;

	onMount(async () => {
		if (browser) {
			storedPin = getSessionItem(partyPinKey(code));
			if (!storedPin) {
				storedPin = await getHostPin(code);
			}
		}

		if (!$party) {
			await loadParty(code);
		}

		// Subscribe to realtime updates (including live scores)
		if ($party) {
			unsubscribe = subscribeToParty($party.id, $party.game_id);
		}
	});

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
		cleanup();
	});

	async function handleDeleteParty() {
		if (!storedPin) return;

		isDeleting = true;

		const result = await deleteParty(storedPin);

		if (result.success) {
			// Clear cached host credentials so a revisit to this URL (back
			// button, bookmark) doesn't leave the panel authorized for a
			// party that no longer exists.
			await removeHostPin(code);
			removeSessionItem(partyPinKey(code));
			await removeRecentParty(code);
			goto('/');
		} else {
			toast.error(result.error || 'Failed to delete party');
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}

	async function handleRemovePlayer() {
		if (!storedPin || !playerToRemove) return;

		isRemovingPlayer = true;

		const result = await removePlayer(storedPin, playerToRemove.normalizedName);

		if (result.success) {
			toast.success(`Removed ${playerToRemove.name} (${result.removedCount} squares freed)`);
			removePlayerSucceeded = true;
			playerToRemove = null;
		} else {
			toast.error(result.error || 'Failed to remove player');
		}

		isRemovingPlayer = false;
	}

	function removePlayerCloseFocusTarget() {
		if (!removePlayerSucceeded) return undefined;
		removePlayerSucceeded = false;
		return partyStatusHeadingEl;
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/party/{code}" class="text-sm hover:opacity-100 text-secondary">← Back to Game</a>
		<h1 class="text-3xl font-bold mt-2">Host Panel</h1>
	</header>

	{#if !storedPin}
		<PinGate {code} onauthorized={(pin) => (storedPin = pin)} />
	{:else if $party}
		<svelte:boundary>
			<div class="space-y-6 max-w-md mx-auto">
				<!-- Current Status -->
				<div class="card">
					<h2 class="text-lg font-semibold mb-2" bind:this={partyStatusHeadingEl} tabindex="-1">
						Party Status
					</h2>
					<div class="text-2xl font-bold capitalize">
						{$party.status === 'locked' ? 'Active' : $party.status}
					</div>
					{#if $party.status === 'filling'}
						<p class="text-sm mt-2 text-secondary">
							{$filledCount}/100 squares filled
						</p>
					{/if}
				</div>

				<!-- Filling Phase Controls -->
				{#if $party.status === 'filling'}
					<EventDetailsCard party={$party} {storedPin} />
					<ManagePlayersCard
						hostNameLower={$party.host_name_lower}
						onremove={(player) => (playerToRemove = player)}
					/>
					<PayoutStructureCard party={$party} {storedPin} />
					<LockGridCard {code} {storedPin} />
				{/if}

				<!-- Active Phase Controls -->
				{#if isGameInProgress($party.status)}
					{#if $party.game_id}
						<LiveScoresPanel party={$party} bind:showManualOverride />
					{/if}
					<ScoreEntryCard
						party={$party}
						{code}
						{storedPin}
						visible={!$party.game_id || showManualOverride}
						description={$party.game_id
							? 'Override live scores from the API if data is incorrect or unavailable.'
							: 'Enter scores and calculate winners for each quarter.'}
					/>
				{/if}

				<!-- Complete Phase -->
				{#if $party.status === 'complete'}
					<div class="card text-center">
						<h2 class="text-lg font-semibold mb-2">Game Complete</h2>
						<p class="text-sm text-secondary">
							The game is over. All winners have been determined. Check the main game view to see
							results.
						</p>
					</div>
				{/if}

				<DangerZoneCard ondelete={() => (showDeleteConfirm = true)} />
			</div>
			{#snippet failed(_error, reset)}
				<div class="card max-w-md mx-auto border border-red-500/30">
					<p class="text-sm text-red-400">The admin panel encountered an error.</p>
					<div class="flex gap-2 mt-2">
						<button class="btn btn-secondary btn-sm" type="button" onclick={reset}>Try again</button
						>
						<button
							class="btn btn-secondary btn-sm"
							type="button"
							onclick={() => window.location.reload()}>Reload</button
						>
					</div>
				</div>
			{/snippet}
		</svelte:boundary>
	{:else if $isLoading}
		<div class="card max-w-md mx-auto text-center">
			<p class="text-secondary">Loading party…</p>
		</div>
	{:else}
		<div class="card max-w-md mx-auto text-center">
			<p class="text-error">{$partyLoadError || 'This party could not be found.'}</p>
			<a href="/" class="btn btn-secondary mt-4">Go Home</a>
		</div>
	{/if}
</div>

<ConfirmDialog
	open={showDeleteConfirm}
	idPrefix="delete-party"
	title="Delete Party?"
	descriptionClass="text-red-400"
	confirmLabel="Yes, Delete"
	busyLabel="Deleting..."
	busy={isDeleting}
	onconfirm={handleDeleteParty}
	oncancel={() => (showDeleteConfirm = false)}
>
	Are you sure? This action cannot be undone. All squares, numbers, and winners will be permanently
	deleted.
</ConfirmDialog>

<ConfirmDialog
	open={playerToRemove !== null}
	idPrefix="remove-player"
	title="Remove Player?"
	confirmLabel="Remove Player"
	busyLabel="Removing..."
	busy={isRemovingPlayer}
	onconfirm={handleRemovePlayer}
	oncancel={() => (playerToRemove = null)}
	closeFocusTarget={removePlayerCloseFocusTarget}
>
	{#if playerToRemove}
		Are you sure you want to remove <strong>{playerToRemove.name}</strong>? This will free up their
		{playerToRemove.count} square{playerToRemove.count !== 1 ? 's' : ''} for others to claim.
	{/if}
</ConfirmDialog>
