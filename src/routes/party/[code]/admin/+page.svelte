<script lang="ts">
	import { page } from '$app/stores';
	import { onMount, onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import { browser } from '$app/environment';
	import {
		partyPinKey,
		getHostPin,
		setHostPin,
		getSessionItem,
		setSessionItem,
		removeHostPin,
		removeSessionItem,
		removeRecentParty,
	} from '$lib/storage';
	import {
		party,
		scores,
		liveScores,
		isGridFull,
		filledCount,
		isLoading,
		error as partyLoadError,
		loadParty,
		lockParty,
		updateScore,
		updatePartyDetails,
		updatePayoutStructure,
		deleteParty,
		removePlayer,
		playerSummary,
		verifyHostPin,
		subscribeToParty,
		broadcastScoreUpdate,
		cleanup,
	} from '$lib/stores/game';
	import type { Quarter, Scores } from '$lib/types';
	import { SPLIT_PRESETS, isGameInProgress } from '$lib/types';
	import { formatQuarterLabel } from '$lib/utils/quarter';
	import {
		datetimeLocalToIso,
		formatKickoff,
		getLocalTimeZoneLabel,
		toDatetimeLocalValue,
	} from '$lib/utils/datetime';
	import { goto } from '$app/navigation';
	import { NFL_TEAM_PRESETS, findNflTeamPreset, findNflTeamPresetId } from '$lib/nflTeams';
	import { areDistinctTeamNames } from '$lib/utils/teamNames';
	import { formatPrice } from '$lib/utils/format';
	import { buildPayoutRows, calculateTotalPot } from '$lib/payouts';

	const code = $derived($page.params.code ?? '');
	let storedPin = $state<string | null>(null);
	let enteredPin = $state('');
	let isAuthorized = $state(false);
	let isLocking = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	// Manual score entry
	const manualScores = $state({
		quarter: 'q1' as Quarter,
		rowScore: 0,
		colScore: 0,
	});
	let isUpdatingScore = $state(false);
	let showManualOverride = $state(false);

	// Payout structure editing
	let payoutSplits = $state({ q1: 10, q2: 20, q3: 30, final: 40 });
	let isUpdatingPayout = $state(false);
	let selectedPreset = $state('Rising');

	// Event details editing
	const partyDetails = $state({
		eventName: '',
		kickoffInput: '',
		teamRowName: '',
		teamColName: '',
		teamRowColor: '#69BE28',
		teamColColor: '#C60C30',
	});
	let isUpdatingDetails = $state(false);
	let kickoffTimeZone = $state('local time');
	let rowTeamPresetId = $state('');
	let colTeamPresetId = $state('');

	// Delete confirmation
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);
	let deleteDialogEl: HTMLDialogElement | null = null;
	// $state: bound inside the {#if showDeleteConfirm} block below, so the
	// element is created/destroyed on each open/close (same reasoning as
	// join/+page.svelte's `pinInputEl`, which is $state for the same reason
	// while its always-mounted `pinDialogEl` sibling is plain `let`).
	let deleteCancelBtn = $state<HTMLButtonElement | null>(null);
	let deleteTriggerEl: HTMLElement | null = null;

	// Native <dialog> for real focus trapping, backdrop, and Escape handling —
	// mirrors src/routes/join/+page.svelte's PIN-challenge dialog pattern.
	$effect(() => {
		if (showDeleteConfirm) {
			if (deleteDialogEl && !deleteDialogEl.open) {
				deleteTriggerEl = document.activeElement as HTMLElement | null;
				deleteDialogEl.showModal();
				// Focus Cancel first, never the destructive action, so a stray
				// Enter keypress can't trigger deletion.
				deleteCancelBtn?.focus();
			}
		} else {
			if (deleteDialogEl?.open) deleteDialogEl.close();
			deleteTriggerEl?.focus();
			deleteTriggerEl = null;
		}
	});

	function cancelDeleteParty() {
		showDeleteConfirm = false;
	}

	// Player removal
	let playerToRemove = $state<{ name: string; normalizedName: string; count: number } | null>(null);
	let isRemovingPlayer = $state(false);
	let removePlayerDialogEl: HTMLDialogElement | null = null;
	// $state for the same reason as deleteCancelBtn above — bound inside the
	// {#if playerToRemove} block, so it mounts/unmounts with the dialog.
	let removePlayerCancelBtn = $state<HTMLButtonElement | null>(null);
	let removePlayerTriggerEl: HTMLElement | null = null;

	$effect(() => {
		if (playerToRemove) {
			if (removePlayerDialogEl && !removePlayerDialogEl.open) {
				removePlayerTriggerEl = document.activeElement as HTMLElement | null;
				removePlayerDialogEl.showModal();
				removePlayerCancelBtn?.focus();
			}
		} else {
			if (removePlayerDialogEl?.open) removePlayerDialogEl.close();
			removePlayerTriggerEl?.focus();
			removePlayerTriggerEl = null;
		}
	});

	function cancelRemovePlayer() {
		playerToRemove = null;
	}

	// Determine the next quarter that needs scores entered, from an explicit
	// scores snapshot. Pure so it can be evaluated against the reactive $scores
	// (for the selector default) AND against a freshly-reloaded get(scores)
	// snapshot in the save success path without depending on runes-batch timing.
	// When all four quarters are already scored it returns 'final' (never a
	// nonexistent "q5"), so advancing after the final save leaves the selector
	// parked on 'final' rather than something nonsensical.
	function deriveNextQuarter(s: Scores | null): Quarter {
		if (!s) return 'q1';
		if (s.q1_row_score === null) return 'q1';
		if (s.q2_row_score === null) return 'q2';
		if (s.q3_row_score === null) return 'q3';
		return 'final';
	}

	const nextQuarter = $derived.by(() => deriveNextQuarter($scores));

	// Get scores for a quarter from an explicit snapshot.
	function scoresForQuarter(s: Scores | null, quarter: Quarter): { row: number; col: number } {
		if (!s) return { row: 0, col: 0 };
		switch (quarter) {
			case 'q1':
				return { row: s.q1_row_score ?? 0, col: s.q1_col_score ?? 0 };
			case 'q2':
				return { row: s.q2_row_score ?? 0, col: s.q2_col_score ?? 0 };
			case 'q3':
				return { row: s.q3_row_score ?? 0, col: s.q3_col_score ?? 0 };
			case 'final':
				return { row: s.final_row_score ?? 0, col: s.final_col_score ?? 0 };
		}
	}

	function syncManualScoreFields(s: Scores | null, quarter: Quarter) {
		const currentScores = scoresForQuarter(s, quarter);
		manualScores.rowScore = currentScores.row;
		manualScores.colScore = currentScores.col;
	}

	// The quarter select's own change handler — a direct user action, so it's
	// fine to resync row/col fields to the newly-selected quarter's committed
	// values here.
	function handleQuarterSelected() {
		syncManualScoreFields($scores, manualScores.quarter);
	}

	// Initialize the quarter selector (to the next quarter needing entry) and
	// its row/col fields ONCE, from the current scores snapshot. `scores` is
	// replaced wholesale on every postgres UPDATE of the scores row —
	// including the game_scores_live_propagate trigger's live-tick updates
	// (migration 017:199-219) — so re-running this on every `$scores` change
	// would silently overwrite the host's in-progress manual override
	// (destroying the exact feature this form exists for). Mirrors
	// payoutSplitsInitialized / partyDetailsInitialized below: initialize
	// once, never clobber unsaved work after that.
	let manualScoreEntryInitialized = $state(false);
	$effect(() => {
		if (!manualScoreEntryInitialized && isGameInProgress($party?.status) && $scores) {
			manualScores.quarter = nextQuarter;
			syncManualScoreFields($scores, nextQuarter);
			manualScoreEntryInitialized = true;
		}
	});

	let unsubscribe: (() => void) | null = null;

	onMount(async () => {
		kickoffTimeZone = getLocalTimeZoneLabel();

		if (browser) {
			storedPin = getSessionItem(partyPinKey(code));
			if (!storedPin) {
				storedPin = await getHostPin(code);
			}
			if (storedPin) {
				isAuthorized = true;
			}
		}

		if (!$party) {
			await loadParty(code);
		}

		// Subscribe to realtime updates (including live scores)
		if ($party) {
			unsubscribe = subscribeToParty($party.id, $party.game_id);
		}
		// Note: payoutSplits is initialized lazily by the effect below — the
		// previous onMount block here was a redundant first-write that the
		// effect always re-ran. Removed to fix the double-effect bug.
	});

	let successTimeout: ReturnType<typeof setTimeout> | null = null;

	function showSuccess(msg: string) {
		if (successTimeout) clearTimeout(successTimeout);
		success = msg;
		successTimeout = setTimeout(() => {
			success = null;
		}, 3000);
	}

	onDestroy(() => {
		if (unsubscribe) unsubscribe();
		if (successTimeout) clearTimeout(successTimeout);
		cleanup();
	});

	// Initialize payoutSplits from party data once. After the user starts
	// editing (via inputs or preset buttons), a realtime party update should
	// NOT clobber their unsaved work. The previous version reset on every
	// store update and silently destroyed the user's edits.
	let payoutSplitsInitialized = $state(false);
	$effect(() => {
		if ($party && !payoutSplitsInitialized) {
			payoutSplits = {
				q1: $party.split_q1,
				q2: $party.split_q2,
				q3: $party.split_q3,
				final: $party.split_final,
			};
			payoutSplitsInitialized = true;
		}
	});

	let partyDetailsInitialized = $state(false);
	$effect(() => {
		if ($party && !partyDetailsInitialized) {
			partyDetails.eventName = $party.event_name;
			partyDetails.kickoffInput = toDatetimeLocalValue($party.kickoff_at);
			partyDetails.teamRowName = $party.team_row_name;
			partyDetails.teamColName = $party.team_col_name;
			partyDetails.teamRowColor = $party.team_row_color;
			partyDetails.teamColColor = $party.team_col_color;
			rowTeamPresetId = findNflTeamPresetId($party.team_row_name, $party.team_row_color);
			colTeamPresetId = findNflTeamPresetId($party.team_col_name, $party.team_col_color);
			partyDetailsInitialized = true;
		}
	});

	function applyTeamPreset(side: 'row' | 'col', teamId: string) {
		const preset = findNflTeamPreset(teamId);
		if (!preset) return;

		if (side === 'row') {
			partyDetails.teamRowName = preset.name;
			partyDetails.teamRowColor = preset.color;
			rowTeamPresetId = preset.id;
		} else {
			partyDetails.teamColName = preset.name;
			partyDetails.teamColColor = preset.color;
			colTeamPresetId = preset.id;
		}
	}

	function swapPartyDetailTeams() {
		const previousRow = {
			name: partyDetails.teamRowName,
			color: partyDetails.teamRowColor,
			presetId: rowTeamPresetId,
		};
		partyDetails.teamRowName = partyDetails.teamColName;
		partyDetails.teamRowColor = partyDetails.teamColColor;
		rowTeamPresetId = colTeamPresetId;
		partyDetails.teamColName = previousRow.name;
		partyDetails.teamColColor = previousRow.color;
		colTeamPresetId = previousRow.presetId;
	}

	const isValidPartyDetails = $derived(
		partyDetails.eventName.trim().length > 0 &&
			partyDetails.eventName.trim().length <= 80 &&
			partyDetails.teamRowName.trim().length > 0 &&
			partyDetails.teamColName.trim().length > 0 &&
			areDistinctTeamNames(partyDetails.teamRowName, partyDetails.teamColName)
	);
	const kickoffPreview = $derived(
		formatKickoff(datetimeLocalToIso(partyDetails.kickoffInput), {
			includeWeekday: true,
			includeTimeZone: true,
		})
	);

	const partyDetailsChanged = $derived(
		$party
			? partyDetails.eventName.trim() !== $party.event_name ||
					datetimeLocalToIso(partyDetails.kickoffInput) !== $party.kickoff_at ||
					partyDetails.teamRowName.trim() !== $party.team_row_name ||
					partyDetails.teamColName.trim() !== $party.team_col_name ||
					partyDetails.teamRowColor !== $party.team_row_color ||
					partyDetails.teamColColor !== $party.team_col_color
			: false
	);
	const hasDistinctPartyDetailTeams = $derived(
		areDistinctTeamNames(partyDetails.teamRowName, partyDetails.teamColName)
	);

	let isVerifyingPin = $state(false);
	let pinError = $state<string | null>(null);
	let pinAttempts = $state(0);

	async function verifyPin() {
		if (enteredPin.length !== 4 || pinAttempts >= 5) return;

		isVerifyingPin = true;
		pinError = null;

		try {
			const isValid = await verifyHostPin(code, enteredPin);
			if (isValid) {
				await setHostPin(code, enteredPin);
				setSessionItem(partyPinKey(code), enteredPin);
				storedPin = enteredPin;
				isAuthorized = true;
				pinAttempts = 0;
			} else {
				pinAttempts++;
				if (pinAttempts >= 5) {
					pinError = 'Too many attempts. Try again later.';
				} else {
					pinError = 'Incorrect PIN. Please try again.';
				}
				enteredPin = '';
			}
		} catch {
			pinError = 'Unable to verify PIN. Please try again.';
		} finally {
			isVerifyingPin = false;
		}
	}

	async function handleLockGrid() {
		if (!storedPin || !$isGridFull) return;

		isLocking = true;
		error = null;
		success = null;

		const result = await lockParty(storedPin);

		if (result.success) {
			// Reload party data so the page reactively shows score entry controls
			try {
				await loadParty(code);
				showSuccess(
					'Game started! Numbers have been assigned. Enter scores below as each quarter ends.'
				);
			} catch {
				error = 'Game started, but failed to reload the latest game data. Please refresh the page.';
			}
		} else {
			error = result.error || 'Failed to lock grid';
		}
		isLocking = false;
	}

	async function handleUpdateScore() {
		if (!storedPin) return;

		isUpdatingScore = true;
		error = null;
		success = null;

		const result = await updateScore(
			storedPin,
			manualScores.quarter,
			manualScores.rowScore,
			manualScores.colScore
		);

		if (result.success) {
			showSuccess(
				`Score updated for ${manualScores.quarter === 'final' ? 'Final' : `Q${manualScores.quarter.slice(1)}`}!`
			);
			broadcastScoreUpdate();
			await loadParty(code);
			// Auto-advance to the next unscored quarter after a discrete, successful
			// save — restoring the behavior that main's paired $effects provided
			// before the live-tick guard removed it. WITHOUT this, the selector stays
			// on the just-saved quarter and the host's next submit silently overwrites
			// it (recomputing that quarter's winner — real money). This advances ONLY
			// on an explicit save, so it does NOT reintroduce the $scores live-tick
			// clobber that manualScoreEntryInitialized guards against.
			//
			// Compute directly from the freshly-reloaded get(scores) snapshot rather
			// than reading the $derived nextQuarter: across the await boundary the
			// store is guaranteed current via get(), whereas the runes-batched
			// $scores binding (and any derived over it) may not have flushed yet.
			const reloadedScores = get(scores);
			const next = deriveNextQuarter(reloadedScores);
			manualScores.quarter = next;
			syncManualScoreFields(reloadedScores, next);
		} else {
			error = result.error || 'Failed to update score';
		}

		isUpdatingScore = false;
	}

	const quarters: { value: Quarter; label: string }[] = [
		{ value: 'q1', label: '1st Quarter' },
		{ value: 'q2', label: '2nd Quarter' },
		{ value: 'q3', label: '3rd Quarter' },
		{ value: 'final', label: 'Final' },
	];

	function applyPreset(presetName: string) {
		const preset = SPLIT_PRESETS.find((p) => p.name === presetName);
		if (preset && preset.name !== 'Custom') {
			payoutSplits = { q1: preset.q1, q2: preset.q2, q3: preset.q3, final: preset.final };
		}
		selectedPreset = presetName;
	}

	const splitTotal = $derived(
		payoutSplits.q1 + payoutSplits.q2 + payoutSplits.q3 + payoutSplits.final
	);
	const payoutTotalPot = $derived(calculateTotalPot($party?.square_price ?? 0));
	const payoutPreviewRows = $derived(buildPayoutRows(payoutSplits, payoutTotalPot));

	async function handleUpdatePayout() {
		if (!storedPin) return;

		isUpdatingPayout = true;
		error = null;
		success = null;

		const result = await updatePayoutStructure(storedPin, payoutSplits);

		if (result.success) {
			showSuccess('Payout structure updated!');
		} else {
			error = result.error || 'Failed to update payout structure';
		}

		isUpdatingPayout = false;
	}

	async function handleUpdatePartyDetails() {
		if (!storedPin || !isValidPartyDetails) return;

		isUpdatingDetails = true;
		error = null;
		success = null;

		const result = await updatePartyDetails(storedPin, {
			eventName: partyDetails.eventName.trim(),
			kickoffAt: datetimeLocalToIso(partyDetails.kickoffInput),
			teamRowName: partyDetails.teamRowName.trim(),
			teamColName: partyDetails.teamColName.trim(),
			teamRowColor: partyDetails.teamRowColor,
			teamColColor: partyDetails.teamColColor,
		});

		if (result.success) {
			showSuccess('Party details updated!');
		} else {
			error = result.error || 'Failed to update party details';
		}

		isUpdatingDetails = false;
	}

	async function handleDeleteParty() {
		if (!storedPin) return;

		isDeleting = true;
		error = null;

		const result = await deleteParty(storedPin);

		if (result.success) {
			// Clear cached host credentials so a revisit to this URL (back
			// button, bookmark) doesn't leave isAuthorized=true pointed at a
			// party that no longer exists.
			await removeHostPin(code);
			removeSessionItem(partyPinKey(code));
			await removeRecentParty(code);
			goto('/');
		} else {
			error = result.error || 'Failed to delete party';
			isDeleting = false;
			showDeleteConfirm = false;
		}
	}

	async function handleRemovePlayer() {
		if (!storedPin || !playerToRemove) return;

		isRemovingPlayer = true;
		error = null;
		success = null;

		const result = await removePlayer(storedPin, playerToRemove.normalizedName);

		if (result.success) {
			showSuccess(`Removed ${playerToRemove.name} (${result.removedCount} squares freed)`);
			playerToRemove = null;
		} else {
			error = result.error || 'Failed to remove player';
		}

		isRemovingPlayer = false;
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/party/{code}" class="text-sm hover:opacity-100 text-secondary">← Back to Game</a>
		<h1 class="text-3xl font-bold mt-2">Host Panel</h1>
	</header>

	{#if !isAuthorized}
		<div class="card max-w-md mx-auto">
			<h2 class="text-xl font-semibold mb-4">Enter Host PIN</h2>
			<form
				onsubmit={(e) => {
					e.preventDefault();
					verifyPin();
				}}
			>
				<input
					type="tel"
					bind:value={enteredPin}
					placeholder="0000"
					maxlength="4"
					pattern="[0-9]*"
					inputmode="numeric"
					class="input text-center text-2xl tracking-widest mb-4"
				/>
				{#if pinError}
					<div class="message-error mb-4">
						{pinError}
					</div>
				{/if}
				<button
					type="submit"
					class="btn btn-primary w-full"
					disabled={enteredPin.length !== 4 || isVerifyingPin || pinAttempts >= 5}
				>
					{isVerifyingPin ? 'Verifying...' : 'Verify'}
				</button>
			</form>
		</div>
	{:else if $party}
		<svelte:boundary>
			<div class="space-y-6 max-w-md mx-auto">
				<!-- Current Status -->
				<div class="card">
					<h2 class="text-lg font-semibold mb-2">Party Status</h2>
					<div class="text-2xl font-bold capitalize">
						{$party.status === 'locked' ? 'Active' : $party.status}
					</div>
					{#if $party.status === 'filling'}
						<p class="text-sm mt-2 text-secondary">
							{$filledCount}/100 squares filled
						</p>
					{/if}
				</div>

				{#if error}
					<div class="message-error">
						{error}
					</div>
				{/if}

				{#if success}
					<div class="message-success">
						{success}
					</div>
				{/if}

				<!-- Filling Phase Controls -->
				{#if $party.status === 'filling'}
					<!-- Event Details -->
					<div class="card">
						<h2 class="text-lg font-semibold mb-4">Event Details</h2>
						<p class="text-sm mb-4 text-secondary">
							Keep the shared party page accurate if the matchup, event title, or kickoff time
							changes before the grid is locked.
						</p>

						<div class="space-y-4">
							<label class="block">
								<span class="text-sm text-secondary">Event name</span>
								<input
									type="text"
									bind:value={partyDetails.eventName}
									class="input mt-1"
									maxlength="80"
									autocomplete="off"
									onblur={() => (partyDetails.eventName = partyDetails.eventName.trim())}
								/>
							</label>

							<label class="block">
								<span class="text-sm text-secondary">Kickoff time</span>
								<span class="text-xs ml-1 text-muted">(optional)</span>
								<input
									type="datetime-local"
									bind:value={partyDetails.kickoffInput}
									class="input mt-1"
								/>
							</label>
							<p class="text-xs text-muted">Timezone: {kickoffTimeZone}</p>
							{#if kickoffPreview}
								<p class="text-sm text-secondary">Kickoff: {kickoffPreview}</p>
							{/if}

							<div class="space-y-3">
								<div class="flex items-center justify-between gap-3">
									<span class="text-sm text-secondary">Matchup</span>
									<button
										type="button"
										class="btn btn-secondary text-sm"
										onclick={swapPartyDetailTeams}
									>
										Swap
									</button>
								</div>
								<div class="flex items-center gap-3">
									<label class="relative cursor-pointer shrink-0" aria-label="Left team color">
										<span
											class="block w-9 h-9 rounded-full border-2 border-white/20 shadow-inner"
											style="background: {partyDetails.teamRowColor}"
										></span>
										<input
											type="color"
											bind:value={partyDetails.teamRowColor}
											class="sr-only"
											aria-label="Left team color picker"
											oninput={() => (rowTeamPresetId = '')}
										/>
									</label>
									<div class="flex-1">
										<label class="block">
											<span class="text-sm text-secondary">Left team NFL preset</span>
											<select
												bind:value={rowTeamPresetId}
												class="input mt-1"
												aria-label="Left team NFL preset"
												onchange={(event) =>
													applyTeamPreset('row', (event.currentTarget as HTMLSelectElement).value)}
											>
												<option value="">Custom left team</option>
												{#each NFL_TEAM_PRESETS as team (team.id)}
													<option value={team.id}>{team.name}</option>
												{/each}
											</select>
										</label>
										<label class="block mt-2">
											<span class="text-sm text-secondary">Left Team</span>
											<input
												type="text"
												bind:value={partyDetails.teamRowName}
												class="input mt-1"
												maxlength="50"
												oninput={() => (rowTeamPresetId = '')}
												onblur={() => (partyDetails.teamRowName = partyDetails.teamRowName.trim())}
											/>
										</label>
									</div>
								</div>

								<div class="flex items-center gap-3">
									<label class="relative cursor-pointer shrink-0" aria-label="Top team color">
										<span
											class="block w-9 h-9 rounded-full border-2 border-white/20 shadow-inner"
											style="background: {partyDetails.teamColColor}"
										></span>
										<input
											type="color"
											bind:value={partyDetails.teamColColor}
											class="sr-only"
											aria-label="Top team color picker"
											oninput={() => (colTeamPresetId = '')}
										/>
									</label>
									<div class="flex-1">
										<label class="block">
											<span class="text-sm text-secondary">Top team NFL preset</span>
											<select
												bind:value={colTeamPresetId}
												class="input mt-1"
												aria-label="Top team NFL preset"
												onchange={(event) =>
													applyTeamPreset('col', (event.currentTarget as HTMLSelectElement).value)}
											>
												<option value="">Custom top team</option>
												{#each NFL_TEAM_PRESETS as team (team.id)}
													<option value={team.id}>{team.name}</option>
												{/each}
											</select>
										</label>
										<label class="block mt-2">
											<span class="text-sm text-secondary">Top Team</span>
											<input
												type="text"
												bind:value={partyDetails.teamColName}
												class="input mt-1"
												maxlength="50"
												oninput={() => (colTeamPresetId = '')}
												onblur={() => (partyDetails.teamColName = partyDetails.teamColName.trim())}
											/>
										</label>
									</div>
								</div>
							</div>
							{#if partyDetails.teamRowName.trim() && partyDetails.teamColName.trim() && !hasDistinctPartyDetailTeams}
								<p class="text-sm" style="color: #fca5a5">
									Choose two different teams for the matchup.
								</p>
							{/if}
							{#if partyDetails.teamRowName.trim() && partyDetails.teamColName.trim() && hasDistinctPartyDetailTeams}
								<div class="rounded-lg border border-white/10 p-3">
									<div class="text-xs uppercase tracking-wide text-muted">Matchup preview</div>
									<div class="mt-1 font-semibold">
										{partyDetails.teamRowName.trim()} vs {partyDetails.teamColName.trim()}
									</div>
									<div class="mt-1 text-xs text-muted">
										{partyDetails.teamRowName.trim()} uses left-side score digits;
										{partyDetails.teamColName.trim()} uses top score digits.
									</div>
								</div>
							{/if}
						</div>

						<button
							onclick={handleUpdatePartyDetails}
							class="btn btn-primary w-full mt-4"
							disabled={isUpdatingDetails || !isValidPartyDetails || !partyDetailsChanged}
						>
							{isUpdatingDetails ? 'Saving...' : 'Save Event Details'}
						</button>
					</div>

					<!-- Manage Players -->
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
												{#if player.normalizedName === $party?.host_name_lower}
													<span class="text-xs ml-1 text-muted">(host)</span>
												{/if}
											</div>
											<div class="text-sm text-secondary">
												{player.count} square{player.count !== 1 ? 's' : ''}
											</div>
										</div>
										{#if player.normalizedName !== $party?.host_name_lower}
											<button
												onclick={() => (playerToRemove = player)}
												class="btn btn-sm"
												style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);"
											>
												Remove
											</button>
										{/if}
									</div>
								{/each}
							</div>
						</div>
					{/if}

					<!-- Payout Structure -->
					<div class="card">
						<h2 class="text-lg font-semibold mb-4">Payout Structure</h2>
						<p class="text-sm mb-4 text-secondary">
							Adjust how the pot is split between quarters. Must total 100%.
						</p>

						<div class="grid grid-cols-4 gap-2 mb-4">
							{#each SPLIT_PRESETS as preset (preset.name)}
								<button
									class="p-2 rounded-lg text-sm font-medium transition-all {selectedPreset ===
									preset.name
										? 'btn-primary'
										: 'btn-secondary'}"
									onclick={() => applyPreset(preset.name)}
								>
									{preset.name}
								</button>
							{/each}
						</div>

						<div class="grid grid-cols-1 gap-3 mb-4">
							<div>
								<label for="split-q1" class="text-sm text-secondary">Q1</label>
								<div class="flex items-center gap-1">
									<input
										id="split-q1"
										type="number"
										bind:value={payoutSplits.q1}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm text-secondary">%</span>
								</div>
							</div>
							<div>
								<label for="split-q2" class="text-sm text-secondary">Q2</label>
								<div class="flex items-center gap-1">
									<input
										id="split-q2"
										type="number"
										bind:value={payoutSplits.q2}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm text-secondary">%</span>
								</div>
							</div>
							<div>
								<label for="split-q3" class="text-sm text-secondary">Q3</label>
								<div class="flex items-center gap-1">
									<input
										id="split-q3"
										type="number"
										bind:value={payoutSplits.q3}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm text-secondary">%</span>
								</div>
							</div>
							<div>
								<label for="split-final" class="text-sm text-secondary">Final</label>
								<div class="flex items-center gap-1">
									<input
										id="split-final"
										type="number"
										bind:value={payoutSplits.final}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm text-secondary">%</span>
								</div>
							</div>
						</div>

						<div class="text-sm mb-4 {splitTotal === 100 ? '' : 'text-red-400'}">
							Total: {splitTotal}% {splitTotal !== 100 ? '(must be 100%)' : '✓'}
						</div>

						<div
							class="mb-4 rounded-lg border p-3"
							style="border-color: rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.03);"
							data-testid="admin-payout-preview"
						>
							<div class="flex items-center justify-between gap-3">
								<span class="text-sm font-medium">Payout preview</span>
								<span class="text-sm text-secondary">Pot {formatPrice(payoutTotalPot)}</span>
							</div>
							<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
								{#each payoutPreviewRows as row (row.key)}
									<div data-testid={`admin-payout-${row.key}`}>
										<div class="text-xs uppercase text-muted">{row.label}</div>
										<div class="font-semibold">{formatPrice(row.amount)}</div>
										<div class="text-xs text-secondary">{row.percent}%</div>
									</div>
								{/each}
							</div>
						</div>

						<button
							onclick={handleUpdatePayout}
							class="btn btn-primary w-full"
							disabled={isUpdatingPayout || splitTotal !== 100}
						>
							{isUpdatingPayout ? 'Saving...' : 'Save Payout Structure'}
						</button>
					</div>

					<div class="card">
						<h2 class="text-lg font-semibold mb-4">Start Game</h2>
						{#if $isGridFull}
							<p class="text-sm mb-4 text-secondary">
								All 100 squares are filled. Lock the grid, assign random numbers, and start the
								game.
							</p>
							<button onclick={handleLockGrid} class="btn btn-success w-full" disabled={isLocking}>
								{isLocking ? 'Starting...' : 'Lock Grid & Start Game'}
							</button>
						{:else}
							<p class="text-sm text-secondary">
								Grid is not full yet ({$filledCount}/100). Wait for all squares to be claimed before
								starting.
							</p>
							<div class="mt-4 progress-bar">
								<div class="progress-bar-fill" style="width: {$filledCount}%"></div>
							</div>
						{/if}
					</div>
				{/if}

				<!-- Active Phase Controls -->
				{#if isGameInProgress($party.status)}
					{#if $party.game_id}
						<!-- API Integration Mode -->
						<div
							class="card"
							style="border: 1px solid rgba(59, 130, 246, 0.3); background: rgba(59, 130, 246, 0.08);"
							role="region"
							aria-label="Live game integration"
						>
							{#if $liveScores?.status && $liveScores.status !== 'pregame'}
								<!-- Live scores display -->
								<div class="flex items-center justify-between">
									<p class="text-sm" style="color: rgb(147, 197, 253);" aria-live="polite">
										<span class="font-semibold">
											{$party.team_row_name}
											{$liveScores.rowScore} - {$party.team_col_name}
											{$liveScores.colScore}
										</span>
										{#if $liveScores.status === 'final'}
											<span class="ml-2" role="status">FINAL</span>
										{:else if $liveScores.status === 'halftime'}
											<span class="ml-2" role="status">HALFTIME</span>
										{:else if $liveScores.clock}
											<span class="ml-2" role="status">
												{$liveScores.clock} - {formatQuarterLabel($liveScores.quarter)}
											</span>
										{/if}
									</p>
								</div>
							{:else}
								<!-- Waiting/Pregame -->
								<p class="text-sm" style="color: rgb(147, 197, 253);">
									<span class="font-semibold">Live API connected</span>
									{#if $liveScores?.status === 'pregame'}
										<span class="ml-2">— Game has not started yet</span>
									{:else}
										<span class="ml-2">— Waiting for game data...</span>
									{/if}
								</p>
							{/if}

							<!-- Toggle always visible when API connected -->
							<button
								onclick={() => (showManualOverride = !showManualOverride)}
								class="text-xs mt-2"
								style="color: rgb(147, 197, 253); opacity: 0.7; background: none; border: none; cursor: pointer; padding: 0; text-decoration: underline;"
							>
								{showManualOverride ? 'Hide manual override' : 'Show manual override'}
							</button>
						</div>

						{#if showManualOverride}
							{@render scoreEntryForm(
								'Override live scores from the API if data is incorrect or unavailable.'
							)}
						{/if}
					{:else}
						<!-- No API Mode - always show manual entry -->
						{@render scoreEntryForm('Enter scores and calculate winners for each quarter.')}
					{/if}
				{/if}

				{#snippet scoreEntryForm(description: string)}
					<div class="card">
						<h2 class="text-lg font-semibold mb-4">Manual Score Entry</h2>
						<p class="text-sm mb-4 text-secondary">
							{description}
						</p>

						<div class="space-y-4">
							<div>
								<label for="quarter-select" class="text-sm text-secondary">Quarter</label>
								<select
									id="quarter-select"
									bind:value={manualScores.quarter}
									class="input mt-1"
									onchange={handleQuarterSelected}
								>
									{#each quarters as q (q.value)}
										<option value={q.value}>{q.label}</option>
									{/each}
								</select>
							</div>

							<div class="grid grid-cols-2 gap-4">
								<div>
									<label for="row-score" class="text-sm text-secondary"
										>{$party.team_row_name}</label
									>
									<input
										id="row-score"
										type="number"
										bind:value={manualScores.rowScore}
										min="0"
										class="input mt-1"
									/>
								</div>
								<div>
									<label for="col-score" class="text-sm text-secondary"
										>{$party.team_col_name}</label
									>
									<input
										id="col-score"
										type="number"
										bind:value={manualScores.colScore}
										min="0"
										class="input mt-1"
									/>
								</div>
							</div>

							<button
								onclick={handleUpdateScore}
								class="btn btn-primary w-full"
								disabled={isUpdatingScore}
							>
								{isUpdatingScore ? 'Updating...' : 'Update Score & Calculate Winner'}
							</button>
						</div>
					</div>
				{/snippet}

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

				<!-- Danger Zone - Delete Party -->
				<div class="card border border-red-500/30">
					<h2 class="text-lg font-semibold mb-2 text-red-400">Danger Zone</h2>
					<p class="text-sm mb-4 text-secondary">
						Permanently delete this party and all associated data.
					</p>
					<button
						onclick={() => (showDeleteConfirm = true)}
						class="btn w-full"
						style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);"
					>
						Delete Party
					</button>
				</div>
			</div>
			{#snippet failed(_error, reset)}
				<div class="card max-w-md mx-auto" style="border: 1px solid rgba(239, 68, 68, 0.3);">
					<p class="text-sm" style="color: #f87171;">The admin panel encountered an error.</p>
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

<!-- Delete Party Confirmation Dialog — native <dialog>, mirrors the join
     page's PIN-challenge modal for focus trap / Escape / backdrop. Kept at
     the template's top level (not nested inside an {#if}/{#each}/{#await}/
     {#key} block) so bind:this stays a stable reference — see
     https://svelte.dev/e/non_reactive_update. -->
<dialog
	bind:this={deleteDialogEl}
	aria-labelledby="delete-party-title"
	aria-describedby="delete-party-description"
	onclose={cancelDeleteParty}
	onclick={(e) => {
		if (e.target === deleteDialogEl) cancelDeleteParty();
	}}
	class="confirm-dialog"
>
	{#if showDeleteConfirm}
		<div class="card max-w-sm w-full" style="background: var(--bg-secondary);">
			<h3 id="delete-party-title" class="text-lg font-semibold mb-2 text-red-400">Delete Party?</h3>
			<p id="delete-party-description" class="text-sm mb-4 text-red-400">
				Are you sure? This action cannot be undone. All squares, numbers, and winners will be
				permanently deleted.
			</p>
			<div class="flex gap-2">
				<button
					bind:this={deleteCancelBtn}
					onclick={cancelDeleteParty}
					class="btn btn-secondary flex-1"
					disabled={isDeleting}
				>
					Cancel
				</button>
				<button
					onclick={handleDeleteParty}
					class="btn flex-1"
					style="background: #ef4444; color: white;"
					disabled={isDeleting}
				>
					{isDeleting ? 'Deleting...' : 'Yes, Delete'}
				</button>
			</div>
		</div>
	{/if}
</dialog>

<!-- Remove Player Confirmation Dialog — native <dialog>, same pattern. -->
<dialog
	bind:this={removePlayerDialogEl}
	aria-labelledby="remove-player-title"
	aria-describedby="remove-player-description"
	onclose={cancelRemovePlayer}
	onclick={(e) => {
		if (e.target === removePlayerDialogEl) cancelRemovePlayer();
	}}
	class="confirm-dialog"
>
	{#if playerToRemove}
		<div class="card max-w-sm w-full" style="background: var(--bg-secondary);">
			<h3 id="remove-player-title" class="text-lg font-semibold mb-2 text-red-400">
				Remove Player?
			</h3>
			<p id="remove-player-description" class="text-sm mb-4 text-secondary">
				Are you sure you want to remove <strong>{playerToRemove.name}</strong>? This will free up
				their {playerToRemove.count} square{playerToRemove.count !== 1 ? 's' : ''} for others to claim.
			</p>
			<div class="flex gap-2">
				<button
					bind:this={removePlayerCancelBtn}
					onclick={cancelRemovePlayer}
					class="btn btn-secondary flex-1"
					disabled={isRemovingPlayer}
				>
					Cancel
				</button>
				<button
					onclick={handleRemovePlayer}
					class="btn flex-1"
					style="background: #ef4444; color: white;"
					disabled={isRemovingPlayer}
				>
					{isRemovingPlayer ? 'Removing...' : 'Remove Player'}
				</button>
			</div>
		</div>
	{/if}
</dialog>

<style>
	/* Hide number input spinner arrows */
	input[type='number']::-webkit-outer-spin-button,
	input[type='number']::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	input[type='number'] {
		-moz-appearance: textfield;
		appearance: textfield;
	}

	.confirm-dialog {
		background: transparent;
		border: none;
		padding: 1rem;
		max-width: min(calc(100vw - 2rem), 24rem);
		width: 100%;
		margin: auto;
	}

	.confirm-dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}
</style>
