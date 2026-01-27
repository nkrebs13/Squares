<script lang="ts">
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import {
		party,
		isGridFull,
		filledCount,
		loadParty,
		lockParty,
		startGame,
		updateScore
	} from '$lib/stores/game';
	import type { Quarter } from '$lib/types';

	let code = $derived($page.params.code ?? '');
	let storedPin = $state<string | null>(null);
	let enteredPin = $state('');
	let isAuthorized = $state(false);
	let isLocking = $state(false);
	let isStarting = $state(false);
	let error = $state<string | null>(null);
	let success = $state<string | null>(null);

	// Manual score entry
	let manualScores = $state({
		quarter: 'q1' as Quarter,
		rowScore: 0,
		colScore: 0
	});
	let isUpdatingScore = $state(false);

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
	});

	function verifyPin() {
		if (enteredPin.length === 4) {
			sessionStorage.setItem(`squares_pin_${code}`, enteredPin);
			storedPin = enteredPin;
			isAuthorized = true;
		}
	}

	async function handleLockGrid() {
		if (!storedPin || !$isGridFull) return;

		isLocking = true;
		error = null;
		success = null;

		const result = await lockParty(storedPin);

		if (result.success) {
			success = 'Grid locked! Numbers have been assigned.';
			await loadParty(code);
		} else {
			error = result.error || 'Failed to lock grid';
		}

		isLocking = false;
	}

	async function handleStartGame() {
		if (!storedPin) return;

		isStarting = true;
		error = null;
		success = null;

		const result = await startGame(storedPin);

		if (result.success) {
			success = 'Game started!';
			await loadParty(code);
		} else {
			error = result.error || 'Failed to start game';
		}

		isStarting = false;
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

	async function handleEndGame() {
		if (!storedPin) return;

		// Use the final quarter update to mark game complete
		const result = await updateScore(storedPin, 'final', manualScores.rowScore, manualScores.colScore);

		if (result.success) {
			success = 'Game marked complete!';
			await loadParty(code);
		} else {
			error = result.error || 'Failed to end game';
		}
	}

	const quarters: { value: Quarter; label: string }[] = [
		{ value: 'q1', label: '1st Quarter' },
		{ value: 'q2', label: '2nd Quarter' },
		{ value: 'q3', label: '3rd Quarter' },
		{ value: 'final', label: 'Final' }
	];
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/party/{code}" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Back to Game</a>
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
				<button type="submit" class="btn btn-primary w-full" disabled={enteredPin.length !== 4}>
					Verify
				</button>
			</form>
		</div>
	{:else if $party}
		<div class="space-y-6 max-w-md mx-auto">
			<!-- Current Status -->
			<div class="card">
				<h2 class="text-lg font-semibold mb-2">Party Status</h2>
				<div class="text-2xl font-bold capitalize">{$party.status}</div>
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
				<div class="card">
					<h2 class="text-lg font-semibold mb-4">Lock Grid</h2>
					{#if $isGridFull}
						<p class="text-sm mb-4" style="color: var(--text-secondary)">
							All 100 squares are filled. Lock the grid to assign random numbers.
						</p>
						<button onclick={handleLockGrid} class="btn btn-success w-full" disabled={isLocking}>
							{isLocking ? 'Locking...' : 'Lock Grid & Assign Numbers'}
						</button>
					{:else}
						<p class="text-sm" style="color: var(--text-secondary)">
							Grid is not full yet ({$filledCount}/100). Wait for all squares to be claimed before
							locking.
						</p>
						<div class="mt-4 progress-bar">
							<div
								class="progress-bar-fill"
								style="width: {$filledCount}%"
							></div>
						</div>
					{/if}
				</div>
			{/if}

			<!-- Locked Phase Controls -->
			{#if $party.status === 'locked'}
				<div class="card">
					<h2 class="text-lg font-semibold mb-4">Start Game</h2>
					<p class="text-sm mb-4" style="color: var(--text-secondary)">
						Grid is locked and numbers are assigned. Start the game when ready.
					</p>
					<button onclick={handleStartGame} class="btn btn-success w-full" disabled={isStarting}>
						{isStarting ? 'Starting...' : 'Start Game'}
					</button>
				</div>
			{/if}

			<!-- Active Phase Controls -->
			{#if $party.status === 'active'}
				<div class="card">
					<h2 class="text-lg font-semibold mb-4">Manual Score Entry</h2>
					<p class="text-sm mb-4" style="color: var(--text-secondary)">Enter scores and calculate winners for each quarter.</p>

					<div class="space-y-4">
						<div>
							<label for="quarter-select" class="text-sm" style="color: var(--text-secondary)">Quarter</label>
							<select id="quarter-select" bind:value={manualScores.quarter} class="input mt-1">
								{#each quarters as q}
									<option value={q.value}>{q.label}</option>
								{/each}
							</select>
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div>
								<label for="row-score" class="text-sm" style="color: var(--text-secondary)">{$party.team_row_name}</label>
								<input
									id="row-score"
									type="number"
									bind:value={manualScores.rowScore}
									min="0"
									class="input mt-1"
								/>
							</div>
							<div>
								<label for="col-score" class="text-sm" style="color: var(--text-secondary)">{$party.team_col_name}</label>
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
		</div>
	{/if}
</div>
