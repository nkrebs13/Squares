<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { SPLIT_PRESETS } from '$lib/types';
	import { userName } from '$lib/stores/user';
	import { rememberHostPin } from '$lib/hostPin';
	import { stageNickname } from '$lib/recentParties';
	import { formatPrice, isValidAmount, parseAmount } from '$lib/utils/format';
	import { datetimeLocalToIso } from '$lib/utils/datetime';
	import { createParty as createPartyService } from '$lib/services/createParty';
	import { APP_CONFIG, DEFAULT_TEAMS } from '$lib/config';
	import { MAX_NAME_LENGTH, MAX_NICKNAME_LENGTH, PIN_LENGTH } from '$lib/constants';
	import {
		isValidEventName,
		isValidHostName,
		isValidMatchup,
		isValidPin,
		toTeamSelection,
	} from '$lib/utils/partyForm';
	import { calculateTotalPot, isValidSplit, presetToSplits } from '$lib/payouts';
	import PinInput from '$lib/components/forms/PinInput.svelte';
	import EventDetailsFields from '$lib/components/forms/EventDetailsFields.svelte';
	import PayoutSplitEditor from '$lib/components/forms/PayoutSplitEditor.svelte';
	import TeamMatchupPicker from '$lib/components/forms/TeamMatchupPicker.svelte';

	let eventName = $state(APP_CONFIG.defaultEventName);
	let kickoffInput = $state('');
	let squarePriceInput = $state('1');
	const squarePrice = $derived(parseAmount(squarePriceInput) ?? 0);
	const isValidPrice = $derived(isValidAmount(squarePriceInput));
	let currentSplit = $state(presetToSplits(SPLIT_PRESETS[0]));
	let hostPin = $state('');
	let hostName = $state('');
	let nickname = $state('');
	let isCreating = $state(false);
	let isReady = $state(false);
	let error = $state<string | null>(null);

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

	onMount(() => {
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

		await rememberHostPin(code, hostPin);

		await userName.setName(hostName.trim());

		stageNickname(code, nickname);

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
		<div class="card">
			<EventDetailsFields bind:eventName bind:kickoffInput />
			<p class="mt-2 text-sm text-muted">
				Use a specific event name so this pool still makes sense when shared or revisited later.
			</p>
		</div>

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

		<div class="card">
			<span class="text-sm text-secondary">Prize split</span>

			<div class="mt-3">
				<PayoutSplitEditor bind:splits={currentSplit} {squarePrice} testIdPrefix="create" />
			</div>
		</div>

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
				pickersClass="mt-4 space-y-4"
				warningClass="mt-3"
				previewClass="mt-4"
			/>
		</div>

		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Your Name (Host)</span>
				<input
					type="text"
					bind:value={hostName}
					placeholder="Enter your name"
					class="input mt-2"
					maxlength={MAX_NAME_LENGTH}
					autocomplete="name"
					onblur={() => (hostName = hostName.trim())}
				/>
			</label>
			<p class="mt-2 text-sm text-muted">This name will be PIN-protected so only you can use it</p>
		</div>

		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Choose your PIN ({PIN_LENGTH} digits)</span>
				<PinInput bind:value={hostPin} class="mt-2" />
			</label>
			<p class="mt-2 text-sm text-muted">You'll need this to lock the grid and manage scores</p>
		</div>

		<div class="card">
			<label class="block">
				<span class="text-sm text-secondary">Game Nickname</span>
				<span class="text-xs ml-1 text-muted">(optional)</span>
				<input
					type="text"
					bind:value={nickname}
					placeholder="e.g. Work Pool, Family Game"
					class="input mt-2"
					maxlength={MAX_NICKNAME_LENGTH}
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
