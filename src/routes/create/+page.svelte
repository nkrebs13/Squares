<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SPLIT_PRESETS } from '$lib/types';
	import { userName } from '$lib/stores/user';
	import { setHostPin, partyPinKey, partyNicknameKey, setSessionItem } from '$lib/storage';
	import { formatPrice, isValidAmount, parseAmount } from '$lib/utils/format';
	import { datetimeLocalToIso, getLocalTimeZoneLabel } from '$lib/utils/datetime';
	import { createParty as createPartyService } from '$lib/services/createParty';
	import { APP_CONFIG, DEFAULT_TEAMS } from '$lib/config';
	import { findNflTeamPresetId } from '$lib/nflTeams';
	import {
		formatKickoffPreview,
		isValidEventName,
		isValidHostName,
		isValidMatchup,
		isValidPin,
	} from '$lib/utils/partyForm';
	import { calculateTotalPot, type PayoutSplits } from '$lib/payouts';
	import PinInput from '$lib/components/forms/PinInput.svelte';
	import PayoutSplitEditor from '$lib/components/forms/PayoutSplitEditor.svelte';
	import PayoutPreview from '$lib/components/forms/PayoutPreview.svelte';
	import TeamMatchupPicker, {
		type TeamSelection,
	} from '$lib/components/forms/TeamMatchupPicker.svelte';

	let eventName = $state(APP_CONFIG.defaultEventName);
	let kickoffInput = $state('');
	let squarePriceInput = $state('1');
	const squarePrice = $derived(parseAmount(squarePriceInput) ?? 0);
	const isValidPrice = $derived(isValidAmount(squarePriceInput));
	const DEFAULT_PRESET = SPLIT_PRESETS[0];
	let selectedPreset = $state(DEFAULT_PRESET.name);
	let currentSplit = $state<PayoutSplits>({
		q1: DEFAULT_PRESET.q1,
		q2: DEFAULT_PRESET.q2,
		q3: DEFAULT_PRESET.q3,
		final: DEFAULT_PRESET.final,
	});
	let hostPin = $state('');
	let hostName = $state('');
	let nickname = $state('');
	let isCreating = $state(false);
	let isReady = $state(false);
	let error = $state<string | null>(null);
	let kickoffTimeZone = $state('local time');

	// Team customization — pre-populated from env-configured defaults
	let rowTeam = $state<TeamSelection>({
		name: DEFAULT_TEAMS.row.name,
		color: DEFAULT_TEAMS.row.color,
		presetId: findNflTeamPresetId(DEFAULT_TEAMS.row.name, DEFAULT_TEAMS.row.color),
	});
	let colTeam = $state<TeamSelection>({
		name: DEFAULT_TEAMS.col.name,
		color: DEFAULT_TEAMS.col.color,
		presetId: findNflTeamPresetId(DEFAULT_TEAMS.col.name, DEFAULT_TEAMS.col.color),
	});

	const splitTotal = $derived(
		currentSplit.q1 + currentSplit.q2 + currentSplit.q3 + currentSplit.final
	);
	const totalPot = $derived(calculateTotalPot(squarePrice));
	const isValidSplit = $derived(splitTotal === 100);
	const canCreate = $derived(
		isValidSplit &&
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

			<PayoutSplitEditor bind:splits={currentSplit} bind:selectedPreset variant="create" />

			<PayoutPreview splits={currentSplit} {squarePrice} testIdPrefix="create" class="mt-4" />
		</div>

		<!-- Teams -->
		<div class="card">
			<TeamMatchupPicker
				bind:row={rowTeam}
				bind:col={colTeam}
				idPrefix="create-team"
				variant="create"
			/>
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
				<PinInput bind:value={hostPin} class="mt-2" />
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
