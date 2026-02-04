<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		party,
		scores,
		isGridFull,
		filledCount,
		loadParty,
		lockParty,
		updateScore,
		updatePayoutStructure,
		deleteParty,
		removePlayer,
		playerSummary,
		verifyHostPin,
	} from '$lib/stores/game';
	import type { Quarter } from '$lib/types';
	import { SPLIT_PRESETS, isGameInProgress } from '$lib/types';
	import { goto } from '$app/navigation';

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

	// Payout structure editing
	let payoutSplits = $state({ q1: 10, q2: 20, q3: 30, final: 40 });
	let isUpdatingPayout = $state(false);
	let selectedPreset = $state('Rising');

	// Delete confirmation
	let showDeleteConfirm = $state(false);
	let isDeleting = $state(false);

	// Player removal
	let playerToRemove = $state<{ name: string; normalizedName: string; count: number } | null>(null);
	let isRemovingPlayer = $state(false);

	// Determine the next quarter that needs scores entered
	const nextQuarter = $derived.by(() => {
		if (!$scores) return 'q1' as Quarter;
		if ($scores.q1_row_score === null) return 'q1' as Quarter;
		if ($scores.q2_row_score === null) return 'q2' as Quarter;
		if ($scores.q3_row_score === null) return 'q3' as Quarter;
		return 'final' as Quarter;
	});

	// Get scores for the currently selected quarter
	function getScoresForQuarter(quarter: Quarter): { row: number; col: number } {
		if (!$scores) return { row: 0, col: 0 };
		switch (quarter) {
			case 'q1':
				return { row: $scores.q1_row_score ?? 0, col: $scores.q1_col_score ?? 0 };
			case 'q2':
				return { row: $scores.q2_row_score ?? 0, col: $scores.q2_col_score ?? 0 };
			case 'q3':
				return { row: $scores.q3_row_score ?? 0, col: $scores.q3_col_score ?? 0 };
			case 'final':
				return { row: $scores.final_row_score ?? 0, col: $scores.final_col_score ?? 0 };
		}
	}

	// Update manualScores when quarter changes or scores change
	$effect(() => {
		const currentScores = getScoresForQuarter(manualScores.quarter);
		manualScores.rowScore = currentScores.row;
		manualScores.colScore = currentScores.col;
	});

	// Set initial quarter to next one needing entry
	$effect(() => {
		if (isGameInProgress($party?.status) && $scores) {
			manualScores.quarter = nextQuarter;
		}
	});

	onMount(async () => {
		if (browser) {
			storedPin = sessionStorage.getItem(`squares_pin_${code}`);
			if (storedPin) {
				isAuthorized = true;
			}
		}

		if (!$party) {
			await loadParty(code);
		}

		// Initialize payout splits from party
		if ($party) {
			payoutSplits = {
				q1: $party.split_q1,
				q2: $party.split_q2,
				q3: $party.split_q3,
				final: $party.split_final,
			};
		}
	});

	// Keep payout splits in sync with party
	$effect(() => {
		if ($party) {
			payoutSplits = {
				q1: $party.split_q1,
				q2: $party.split_q2,
				q3: $party.split_q3,
				final: $party.split_final,
			};
		}
	});

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
				sessionStorage.setItem(`squares_pin_${code}`, enteredPin);
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
				success =
					'Game started! Numbers have been assigned. Enter scores below as each quarter ends.';
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
			success = `Score updated for ${manualScores.quarter === 'final' ? 'Final' : `Q${manualScores.quarter.slice(1)}`}!`;
			await loadParty(code);
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

	async function handleUpdatePayout() {
		if (!storedPin) return;

		isUpdatingPayout = true;
		error = null;
		success = null;

		const result = await updatePayoutStructure(storedPin, payoutSplits);

		if (result.success) {
			success = 'Payout structure updated!';
		} else {
			error = result.error || 'Failed to update payout structure';
		}

		isUpdatingPayout = false;
	}

	async function handleDeleteParty() {
		if (!storedPin) return;

		isDeleting = true;
		error = null;

		const result = await deleteParty(storedPin);

		if (result.success) {
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
			success = `Removed ${playerToRemove.name} (${result.removedCount} squares freed)`;
			playerToRemove = null;
		} else {
			error = result.error || 'Failed to remove player';
		}

		isRemovingPlayer = false;
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/party/{code}" class="text-sm hover:opacity-100" style="color: var(--text-secondary)"
			>← Back to Game</a
		>
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
						<p class="text-sm mt-2" style="color: var(--text-secondary)">
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
					<!-- Manage Players -->
					{#if $playerSummary.length > 0}
						<div class="card">
							<h2 class="text-lg font-semibold mb-4">Manage Players</h2>
							<p class="text-sm mb-4" style="color: var(--text-secondary)">
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
													<span class="text-xs ml-1" style="color: var(--text-muted)">(host)</span>
												{/if}
											</div>
											<div class="text-sm" style="color: var(--text-secondary)">
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
						<p class="text-sm mb-4" style="color: var(--text-secondary)">
							Adjust how the pot is split between quarters. Must total 100%.
						</p>

						<div class="flex gap-2 mb-4 flex-wrap">
							{#each SPLIT_PRESETS as preset (preset.name)}
								<button
									class="btn btn-sm {selectedPreset === preset.name
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
								<label class="text-sm" style="color: var(--text-secondary)">Q1</label>
								<div class="flex items-center gap-1">
									<input
										type="number"
										bind:value={payoutSplits.q1}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm" style="color: var(--text-secondary)">%</span>
								</div>
							</div>
							<div>
								<label class="text-sm" style="color: var(--text-secondary)">Q2</label>
								<div class="flex items-center gap-1">
									<input
										type="number"
										bind:value={payoutSplits.q2}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm" style="color: var(--text-secondary)">%</span>
								</div>
							</div>
							<div>
								<label class="text-sm" style="color: var(--text-secondary)">Q3</label>
								<div class="flex items-center gap-1">
									<input
										type="number"
										bind:value={payoutSplits.q3}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm" style="color: var(--text-secondary)">%</span>
								</div>
							</div>
							<div>
								<label class="text-sm" style="color: var(--text-secondary)">Final</label>
								<div class="flex items-center gap-1">
									<input
										type="number"
										bind:value={payoutSplits.final}
										min="0"
										max="100"
										class="input mt-1"
										onchange={() => (selectedPreset = 'Custom')}
									/>
									<span class="text-sm" style="color: var(--text-secondary)">%</span>
								</div>
							</div>
						</div>

						<div class="text-sm mb-4 {splitTotal === 100 ? '' : 'text-red-400'}">
							Total: {splitTotal}% {splitTotal !== 100 ? '(must be 100%)' : '✓'}
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
							<p class="text-sm mb-4" style="color: var(--text-secondary)">
								All 100 squares are filled. Lock the grid, assign random numbers, and start the
								game.
							</p>
							<button onclick={handleLockGrid} class="btn btn-success w-full" disabled={isLocking}>
								{isLocking ? 'Starting...' : 'Lock Grid & Start Game'}
							</button>
						{:else}
							<p class="text-sm" style="color: var(--text-secondary)">
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
					<div class="card">
						<h2 class="text-lg font-semibold mb-4">Manual Score Entry</h2>
						<p class="text-sm mb-4" style="color: var(--text-secondary)">
							Enter scores and calculate winners for each quarter.
						</p>

						<div class="space-y-4">
							<div>
								<label for="quarter-select" class="text-sm" style="color: var(--text-secondary)"
									>Quarter</label
								>
								<select id="quarter-select" bind:value={manualScores.quarter} class="input mt-1">
									{#each quarters as q (q.value)}
										<option value={q.value}>{q.label}</option>
									{/each}
								</select>
							</div>

							<div class="grid grid-cols-2 gap-4">
								<div>
									<label for="row-score" class="text-sm" style="color: var(--text-secondary)"
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
									<label for="col-score" class="text-sm" style="color: var(--text-secondary)"
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

					<div class="card">
						<h2 class="text-lg font-semibold mb-4">Game Info</h2>
						<p class="text-sm" style="color: var(--text-secondary)">
							Enter scores for each quarter as they complete. The winning square will be
							automatically highlighted based on the last digit of each team's score.
						</p>
					</div>
				{/if}

				<!-- Complete Phase -->
				{#if $party.status === 'complete'}
					<div class="card text-center">
						<h2 class="text-lg font-semibold mb-2">Game Complete</h2>
						<p class="text-sm" style="color: var(--text-secondary)">
							The game is over. All winners have been determined. Check the main game view to see
							results.
						</p>
					</div>
				{/if}

				<!-- Danger Zone - Delete Party -->
				<div class="card border border-red-500/30">
					<h2 class="text-lg font-semibold mb-2 text-red-400">Danger Zone</h2>
					{#if !showDeleteConfirm}
						<p class="text-sm mb-4" style="color: var(--text-secondary)">
							Permanently delete this party and all associated data.
						</p>
						<button
							onclick={() => (showDeleteConfirm = true)}
							class="btn w-full"
							style="background: rgba(239, 68, 68, 0.2); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3);"
						>
							Delete Party
						</button>
					{:else}
						<p class="text-sm mb-4 text-red-400">
							Are you sure? This action cannot be undone. All squares, numbers, and winners will be
							permanently deleted.
						</p>
						<div class="flex gap-2">
							<button
								onclick={() => (showDeleteConfirm = false)}
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
					{/if}
				</div>
			</div>

			<!-- Remove Player Confirmation Dialog -->
			{#if playerToRemove}
				<div
					class="fixed inset-0 z-50 flex items-center justify-center p-4"
					style="background: rgba(0, 0, 0, 0.7);"
				>
					<div class="card max-w-sm w-full" style="background: var(--bg-secondary);">
						<h3 class="text-lg font-semibold mb-2 text-red-400">Remove Player?</h3>
						<p class="text-sm mb-4" style="color: var(--text-secondary)">
							Are you sure you want to remove <strong>{playerToRemove.name}</strong>? This will free
							up their {playerToRemove.count} square{playerToRemove.count !== 1 ? 's' : ''} for others
							to claim.
						</p>
						<div class="flex gap-2">
							<button
								onclick={() => (playerToRemove = null)}
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
				</div>
			{/if}
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
	{/if}
</div>

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
</style>
