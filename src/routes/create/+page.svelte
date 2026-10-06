<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SPLIT_PRESETS, type Quarter, type SplitPreset } from '$lib/types';
	import { userName } from '$lib/stores/user';
	import { setHostPin, partyPinKey, partyNicknameKey, setSessionItem } from '$lib/storage';
	import { formatPrice, isValidAmount, parseAmount } from '$lib/utils/format';
	import { datetimeLocalToIso, getLocalTimeZoneLabel } from '$lib/utils/datetime';
	import { createParty as createPartyService } from '$lib/services/createParty';
	import { APP_CONFIG, DEFAULT_TEAMS } from '$lib/config';
	import {
		formatKickoffPreview,
		isValidEventName,
		isValidHostName,
		isValidMatchup,
		isValidPin,
		MAX_EVENT_NAME_LENGTH,
		toTeamSelection,
	} from '$lib/utils/partyForm';
	import {
		CUSTOM_PRESET_NAME,
		calculateTotalPot,
		isValidSplit,
		presetToSplits,
		splitTotal,
	} from '$lib/payouts';
	import PinInput from '$lib/components/forms/PinInput.svelte';
	import PayoutPresetButtons from '$lib/components/forms/PayoutPresetButtons.svelte';
	import PayoutPreview from '$lib/components/forms/PayoutPreview.svelte';
	import TeamMatchupPicker from '$lib/components/forms/TeamMatchupPicker.svelte';

	const QUARTERS: { key: Quarter; label: string }[] = [
		{ key: 'q1', label: 'Q1' },
		{ key: 'q2', label: 'Q2' },
		{ key: 'q3', label: 'Q3' },
		{ key: 'final', label: 'Final' },
	];

	let eventName = $state(APP_CONFIG.defaultEventName);
	let kickoffInput = $state('');
	let squarePriceInput = $state('1');
	const squarePrice = $derived(parseAmount(squarePriceInput) ?? 0);
	const isValidPrice = $derived(isValidAmount(squarePriceInput));
	const DEFAULT_PRESET = SPLIT_PRESETS[0];
	const EQUAL_PRESET = SPLIT_PRESETS.find((p) => p.name === 'Equal') ?? DEFAULT_PRESET;
	let selectedPreset = $state<SplitPreset>(DEFAULT_PRESET);
	// Hand-entered percentages. Kept apart from the presets so they survive
	// switching to a preset and back.
	const customSplit = $state(presetToSplits(EQUAL_PRESET));
	const isCustom = $derived(selectedPreset.name === CUSTOM_PRESET_NAME);
	const currentSplit = $derived(isCustom ? customSplit : presetToSplits(selectedPreset));
	let hostPin = $state('');
	let hostName = $state('');
	let nickname = $state('');
	let isCreating = $state(false);
	let isReady = $state(false);
	let error = $state<string | null>(null);
	let kickoffTimeZone = $state('local time');

	// Team customization — pre-populated from env-configured defaults
	let rowTeam = $state(toTeamSelection(DEFAULT_TEAMS.row.name, DEFAULT_TEAMS.row.color));
	let colTeam = $state(toTeamSelection(DEFAULT_TEAMS.col.name, DEFAULT_TEAMS.col.color));

	const totalPot = $derived(calculateTotalPot(squarePrice));
	const canCreate = $derived(
		isValidSplit(currentSplit) &&
			isValidPin(hostPin) &&
			isValidHostName(hostName) &&
			isValidEventName(eventName) &&
			isValidPrice &&
			isValidMatchup(rowTeam.name, colTeam.name)
	);

	const kickoffAt = $derived(datetimeLocalToIso(kickoffInput));
	const kickoffPreview = $derived(formatKickoffPreview(kickoffInput));

	onMount(() => {
		kickoffTimeZone = getLocalTimeZoneLabel();
		isReady = true;
	});

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
		<a href="/" class="text-sm hover:opacity-100 text-secondary">← Back</a>
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
				<span class="text-sm text-secondary">Event name</span>
				<input
					type="text"
					bind:value={eventName}
					placeholder="e.g. 2027 Super Bowl"
					class="input mt-2"
					maxlength={MAX_EVENT_NAME_LENGTH}
					autocomplete="off"
					onblur={() => (eventName = eventName.trim() || APP_CONFIG.defaultEventName)}
				/>
			</label>
			<label class="block mt-4">
				<span class="text-sm text-secondary">Kickoff time</span>
				<span class="text-xs ml-1 text-muted">(optional)</span>
				<input type="datetime-local" bind:value={kickoffInput} class="input mt-2" />
			</label>
			<p class="mt-2 text-xs text-muted">
				Timezone: {kickoffTimeZone}
			</p>
			{#if kickoffPreview}
				<p class="mt-1 text-sm text-secondary">
					Kickoff: {kickoffPreview}
				</p>
			{/if}
			<p class="mt-2 text-sm text-muted">
				Use a specific event name so this pool still makes sense when shared or revisited later.
			</p>
		</div>

		<!-- Square Price -->
		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Price per square</span>
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
					<p class="mt-2 text-sm text-error">Enter a valid amount (e.g., 1, 5.50, 10)</p>
				{/if}
			</label>
			<p class="mt-2 text-sm text-muted">
				Total pot: {formatPrice(totalPot)}
			</p>
		</div>

		<!-- Prize Split -->
		<div class="card">
			<span class="text-sm text-secondary">Prize split</span>

			<PayoutPresetButtons
				selected={selectedPreset.name}
				onselect={(preset) => (selectedPreset = preset)}
				class="mt-3"
			/>

			<div class="mt-4 grid grid-cols-4 gap-3">
				{#each QUARTERS as { key, label } (key)}
					<div class="text-center">
						<label for="split-{key}" class="text-xs uppercase block text-muted">{label}</label>
						{#if isCustom}
							<input
								id="split-{key}"
								type="number"
								bind:value={customSplit[key]}
								min="0"
								max="100"
								class="input mt-1 text-center p-2"
								aria-label="{label} prize split percentage"
							/>
						{:else}
							<div id="split-{key}" class="mt-1 text-lg font-bold">{currentSplit[key]}%</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if !isValidSplit(currentSplit)}
				<p class="mt-3 text-sm text-error">
					Split must total 100% (currently {splitTotal(currentSplit)}%)
				</p>
			{/if}

			<PayoutPreview splits={currentSplit} {squarePrice} testIdPrefix="create" class="mt-4" />
		</div>

		<!-- Teams -->
		<div class="card">
			<TeamMatchupPicker
				bind:row={rowTeam}
				bind:col={colTeam}
				idPrefix="create-team"
				title="Teams"
				helpText="Set the teams playing — scores run left ↕ for the Left Team, top ↔ for the Top Team"
				placeholders={['e.g. Chiefs', 'e.g. Eagles']}
				presetLabel="NFL preset"
				labelClass="text-xs uppercase tracking-wide text-muted"
				nameMaxLength={30}
				pickersClass="mt-4 space-y-4"
				warningClass="mt-3"
				previewClass="mt-4"
			/>
		</div>

		<!-- Host Name -->
		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Your Name (Host)</span>
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
			<p class="mt-2 text-sm text-muted">This name will be PIN-protected so only you can use it</p>
		</div>

		<!-- Host PIN -->
		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Choose your PIN (4 digits)</span>
				<PinInput bind:value={hostPin} class="mt-2" />
			</label>
			<p class="mt-2 text-sm text-muted">You'll need this to lock the grid and manage scores</p>
		</div>

		<!-- Game Nickname (optional) -->
		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Game Nickname</span>
				<span class="text-xs ml-1 text-muted">(optional)</span>
				<input
					type="text"
					bind:value={nickname}
					placeholder="e.g. Work Pool, Family Game"
					class="input mt-2"
					maxlength="30"
				/>
			</label>
			<p class="mt-2 text-sm text-muted">Helps you tell games apart if you're in multiple pools</p>
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
