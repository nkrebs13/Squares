<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SPLIT_PRESETS, type SplitPreset } from '$lib/types';
	import { userName } from '$lib/stores/user';
	import { setHostPin, partyPinKey, partyNicknameKey, setSessionItem } from '$lib/storage';
	import { formatPrice, isValidAmount, parseAmount } from '$lib/utils/format';
	import { datetimeLocalToIso, formatKickoff, getLocalTimeZoneLabel } from '$lib/utils/datetime';
	import { createParty as createPartyService } from '$lib/services/createParty';
	import { APP_CONFIG, DEFAULT_TEAMS } from '$lib/config';
	import { NFL_TEAM_PRESETS, findNflTeamPreset, findNflTeamPresetId } from '$lib/nflTeams';
	import { areDistinctTeamNames } from '$lib/utils/teamNames';
	import { buildPayoutRows, calculateTotalPot } from '$lib/payouts';

	let eventName = $state(APP_CONFIG.defaultEventName);
	let kickoffInput = $state('');
	let squarePriceInput = $state('1');
	const squarePrice = $derived(parseAmount(squarePriceInput) ?? 0);
	const isValidPrice = $derived(isValidAmount(squarePriceInput));
	let selectedPreset = $state<SplitPreset>(SPLIT_PRESETS[0]);
	const customSplit = $state({ q1: 25, q2: 25, q3: 25, final: 25 });
	let hostPin = $state('');
	let hostName = $state('');
	let nickname = $state('');
	let isCreating = $state(false);
	let isReady = $state(false);
	let error = $state<string | null>(null);
	let kickoffTimeZone = $state('local time');

	// Team customization — pre-populated from env-configured defaults
	const rowTeam = $state({ name: DEFAULT_TEAMS.row.name, color: DEFAULT_TEAMS.row.color });
	const colTeam = $state({ name: DEFAULT_TEAMS.col.name, color: DEFAULT_TEAMS.col.color });
	let rowTeamPresetId = $state(findNflTeamPresetId(rowTeam.name, rowTeam.color));
	let colTeamPresetId = $state(findNflTeamPresetId(colTeam.name, colTeam.color));

	const isCustom = $derived(selectedPreset.name === 'Custom');

	const currentSplit = $derived(
		isCustom
			? customSplit
			: {
					q1: selectedPreset.q1,
					q2: selectedPreset.q2,
					q3: selectedPreset.q3,
					final: selectedPreset.final,
				}
	);

	const splitTotal = $derived(
		currentSplit.q1 + currentSplit.q2 + currentSplit.q3 + currentSplit.final
	);
	const totalPot = $derived(calculateTotalPot(squarePrice));
	const payoutPreviewRows = $derived(buildPayoutRows(currentSplit, totalPot));
	const isValidSplit = $derived(splitTotal === 100);
	const isValidPin = $derived(hostPin.length === 4 && /^\d+$/.test(hostPin));
	const isValidHostName = $derived(hostName.trim().length > 0);
	const isValidEventName = $derived(eventName.trim().length > 0 && eventName.trim().length <= 80);
	const hasDistinctTeams = $derived(areDistinctTeamNames(rowTeam.name, colTeam.name));
	const canCreate = $derived(
		isValidSplit &&
			isValidPin &&
			isValidHostName &&
			isValidEventName &&
			isValidPrice &&
			rowTeam.name.trim().length > 0 &&
			colTeam.name.trim().length > 0 &&
			hasDistinctTeams
	);

	const kickoffAt = $derived(datetimeLocalToIso(kickoffInput));
	const kickoffPreview = $derived(
		formatKickoff(kickoffAt, { includeWeekday: true, includeTimeZone: true })
	);

	onMount(() => {
		kickoffTimeZone = getLocalTimeZoneLabel();
		isReady = true;
	});

	function applyTeamPreset(side: 'row' | 'col', teamId: string) {
		const preset = findNflTeamPreset(teamId);
		if (!preset) return;

		if (side === 'row') {
			rowTeam.name = preset.name;
			rowTeam.color = preset.color;
			rowTeamPresetId = preset.id;
		} else {
			colTeam.name = preset.name;
			colTeam.color = preset.color;
			colTeamPresetId = preset.id;
		}
	}

	function swapTeams() {
		const previousRow = { name: rowTeam.name, color: rowTeam.color, presetId: rowTeamPresetId };
		rowTeam.name = colTeam.name;
		rowTeam.color = colTeam.color;
		rowTeamPresetId = colTeamPresetId;
		colTeam.name = previousRow.name;
		colTeam.color = previousRow.color;
		colTeamPresetId = previousRow.presetId;
	}

	async function createParty() {
		if (!canCreate || isCreating) return;

		isCreating = true;
		error = null;

		const result = await createPartyService({
			eventName: eventName.trim(),
			kickoffAt,
			hostName: hostName.trim(),
			hostPin,
			squarePrice,
			splits: currentSplit,
			teams: {
				row: { name: rowTeam.name.trim(), color: rowTeam.color },
				col: { name: colTeam.name.trim(), color: colTeam.color },
			},
		});

		if (!result.ok) {
			error = result.error;
			isCreating = false;
			return;
		}

		const code = result.party.code;

		// Persist PIN locally for host actions
		await setHostPin(code, hostPin);
		setSessionItem(partyPinKey(code), hostPin);

		// Persist host name
		await userName.setName(hostName.trim());

		// Hand the party page an optional nickname for this code
		if (nickname.trim()) {
			setSessionItem(partyNicknameKey(code), nickname.trim());
		}

		goto(`/party/${code}`);
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Back</a>
		<h1 class="text-3xl font-bold mt-2">Create Party</h1>
	</header>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			createParty();
		}}
		class="space-y-6 max-w-md mx-auto"
		data-ready={isReady}
	>
		<!-- Event Details -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Event name</span>
				<input
					type="text"
					bind:value={eventName}
					placeholder="e.g. 2027 Super Bowl"
					class="input mt-2"
					maxlength="80"
					autocomplete="off"
					onblur={() => (eventName = eventName.trim() || APP_CONFIG.defaultEventName)}
				/>
			</label>
			<label class="block mt-4">
				<span class="text-sm" style="color: var(--text-secondary)">Kickoff time</span>
				<span class="text-xs ml-1" style="color: var(--text-muted)">(optional)</span>
				<input type="datetime-local" bind:value={kickoffInput} class="input mt-2" />
			</label>
			<p class="mt-2 text-xs" style="color: var(--text-muted)">
				Timezone: {kickoffTimeZone}
			</p>
			{#if kickoffPreview}
				<p class="mt-1 text-sm" style="color: var(--text-secondary)">
					Kickoff: {kickoffPreview}
				</p>
			{/if}
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Use a specific event name so this pool still makes sense when shared or revisited later.
			</p>
		</div>

		<!-- Square Price -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Price per square</span>
				<div class="mt-2 flex items-center gap-2">
					<span class="text-2xl">$</span>
					<input
						type="text"
						inputmode="decimal"
						bind:value={squarePriceInput}
						class="input input-no-spinner text-2xl w-24"
						placeholder="0"
					/>
				</div>
				{#if !isValidPrice && squarePriceInput !== ''}
					<p class="mt-2 text-sm" style="color: #fca5a5">
						Enter a valid amount (e.g., 1, 5.50, 10)
					</p>
				{/if}
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Total pot: {formatPrice(totalPot)}
			</p>
		</div>

		<!-- Prize Split -->
		<div class="card">
			<span class="text-sm" style="color: var(--text-secondary)">Prize split</span>

			<div class="mt-3 grid grid-cols-4 gap-2">
				{#each SPLIT_PRESETS as preset (preset.name)}
					<button
						type="button"
						class="p-2 rounded-lg text-sm font-medium transition-all {selectedPreset.name ===
						preset.name
							? 'btn-primary'
							: 'btn-secondary'}"
						onclick={() => (selectedPreset = preset)}
					>
						{preset.name}
					</button>
				{/each}
			</div>

			<div class="mt-4 grid grid-cols-4 gap-3">
				{#each ['q1', 'q2', 'q3', 'final'] as quarter (quarter)}
					<div class="text-center">
						<label
							for="split-{quarter}"
							class="text-xs uppercase block"
							style="color: var(--text-muted)"
						>
							{quarter === 'final' ? 'Final' : quarter.toUpperCase()}
						</label>
						{#if isCustom}
							<input
								id="split-{quarter}"
								type="number"
								bind:value={customSplit[quarter as keyof typeof customSplit]}
								min="0"
								max="100"
								class="input mt-1 text-center p-2"
								aria-label="{quarter === 'final'
									? 'Final'
									: quarter.toUpperCase()} prize split percentage"
							/>
						{:else}
							<div id="split-{quarter}" class="mt-1 text-lg font-bold">
								{currentSplit[quarter as keyof typeof currentSplit]}%
							</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if !isValidSplit}
				<p class="mt-3 text-sm" style="color: #fca5a5">
					Split must total 100% (currently {splitTotal}%)
				</p>
			{/if}

			<div
				class="mt-4 rounded-lg border p-3"
				style="border-color: rgba(255, 255, 255, 0.12); background: rgba(255, 255, 255, 0.03);"
				data-testid="create-payout-preview"
			>
				<div class="flex items-center justify-between gap-3">
					<span class="text-sm font-medium">Payout preview</span>
					<span class="text-sm" style="color: var(--text-secondary)">
						Pot {formatPrice(totalPot)}
					</span>
				</div>
				<div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
					{#each payoutPreviewRows as row (row.key)}
						<div data-testid={`create-payout-${row.key}`}>
							<div class="text-xs uppercase" style="color: var(--text-muted)">{row.label}</div>
							<div class="font-semibold">{formatPrice(row.amount)}</div>
							<div class="text-xs" style="color: var(--text-secondary)">{row.percent}%</div>
						</div>
					{/each}
				</div>
			</div>
		</div>

		<!-- Teams -->
		<div class="card">
			<div class="flex items-center justify-between gap-3">
				<span class="text-sm" style="color: var(--text-secondary)">Teams</span>
				<button type="button" class="btn btn-secondary text-sm" onclick={swapTeams}> Swap </button>
			</div>
			<p class="text-xs mt-1" style="color: var(--text-muted)">
				Set the teams playing — scores run left ↕ for the Left Team, top ↔ for the Top Team
			</p>
			<div class="mt-4 space-y-4">
				<!-- Left Team (row scores) -->
				<div class="flex items-center gap-3">
					<label class="relative cursor-pointer shrink-0" aria-label="Left team color">
						<span
							class="block w-9 h-9 rounded-full border-2 border-white/20 shadow-inner"
							style="background: {rowTeam.color}"
						></span>
						<input
							type="color"
							bind:value={rowTeam.color}
							class="sr-only"
							aria-label="Left team color picker"
							oninput={() => (rowTeamPresetId = '')}
						/>
					</label>
					<div class="flex-1">
						<label class="block">
							<span class="text-xs uppercase tracking-wide" style="color: var(--text-muted)"
								>NFL preset</span
							>
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
						<label class="block">
							<span class="text-xs uppercase tracking-wide" style="color: var(--text-muted)"
								>Left Team</span
							>
							<input
								type="text"
								bind:value={rowTeam.name}
								placeholder="e.g. Chiefs"
								class="input mt-1"
								maxlength="30"
								oninput={() => (rowTeamPresetId = '')}
								onblur={() => (rowTeam.name = rowTeam.name.trim())}
							/>
						</label>
					</div>
				</div>
				<!-- Top Team (column scores) -->
				<div class="flex items-center gap-3">
					<label class="relative cursor-pointer shrink-0" aria-label="Top team color">
						<span
							class="block w-9 h-9 rounded-full border-2 border-white/20 shadow-inner"
							style="background: {colTeam.color}"
						></span>
						<input
							type="color"
							bind:value={colTeam.color}
							class="sr-only"
							aria-label="Top team color picker"
							oninput={() => (colTeamPresetId = '')}
						/>
					</label>
					<div class="flex-1">
						<label class="block">
							<span class="text-xs uppercase tracking-wide" style="color: var(--text-muted)"
								>NFL preset</span
							>
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
						<label class="block">
							<span class="text-xs uppercase tracking-wide" style="color: var(--text-muted)"
								>Top Team</span
							>
							<input
								type="text"
								bind:value={colTeam.name}
								placeholder="e.g. Eagles"
								class="input mt-1"
								maxlength="30"
								oninput={() => (colTeamPresetId = '')}
								onblur={() => (colTeam.name = colTeam.name.trim())}
							/>
						</label>
					</div>
				</div>
			</div>
			{#if rowTeam.name.trim() && colTeam.name.trim() && !hasDistinctTeams}
				<p class="mt-3 text-sm" style="color: #fca5a5">
					Choose two different teams for the matchup.
				</p>
			{/if}
			{#if rowTeam.name.trim() && colTeam.name.trim() && hasDistinctTeams}
				<div class="mt-4 rounded-lg border border-white/10 p-3">
					<div class="text-xs uppercase tracking-wide" style="color: var(--text-muted)">
						Matchup preview
					</div>
					<div class="mt-1 font-semibold">{rowTeam.name.trim()} vs {colTeam.name.trim()}</div>
					<div class="mt-1 text-xs" style="color: var(--text-muted)">
						{rowTeam.name.trim()} uses left-side score digits; {colTeam.name.trim()} uses top score digits.
					</div>
				</div>
			{/if}
		</div>

		<!-- Host Name -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Your Name (Host)</span>
				<input
					type="text"
					bind:value={hostName}
					placeholder="Enter your name"
					class="input mt-2"
					maxlength="20"
					autocomplete="name"
					onblur={() => (hostName = hostName.trim())}
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				This name will be PIN-protected so only you can use it
			</p>
		</div>

		<!-- Host PIN -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Choose your PIN (4 digits)</span>
				<input
					type="tel"
					bind:value={hostPin}
					placeholder="0000"
					maxlength="4"
					pattern="[0-9]*"
					inputmode="numeric"
					class="input mt-2 text-center text-2xl tracking-widest"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				You'll need this to lock the grid and manage scores
			</p>
		</div>

		<!-- Game Nickname (optional) -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Game Nickname</span>
				<span class="text-xs ml-1" style="color: var(--text-muted)">(optional)</span>
				<input
					type="text"
					bind:value={nickname}
					placeholder="e.g. Work Pool, Family Game"
					class="input mt-2"
					maxlength="30"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Helps you tell games apart if you're in multiple pools
			</p>
		</div>

		{#if error}
			<div class="message-error">
				{error}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary w-full" disabled={!canCreate || isCreating}>
			{isCreating ? 'Creating...' : 'Create Party'}
		</button>
	</form>
</div>
