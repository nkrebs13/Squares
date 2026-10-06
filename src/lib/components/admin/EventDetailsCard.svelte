<script lang="ts">
	import { onMount } from 'svelte';
	import { updatePartyDetails } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import type { Party } from '$lib/types';
	import {
		datetimeLocalToIso,
		getLocalTimeZoneLabel,
		toDatetimeLocalValue,
	} from '$lib/utils/datetime';
	import { MAX_EVENT_NAME_LENGTH } from '$lib/constants';
	import {
		formatKickoffPreview,
		isValidEventName,
		isValidMatchup,
		toTeamSelection,
	} from '$lib/utils/partyForm';
	import TeamMatchupPicker from '$lib/components/forms/TeamMatchupPicker.svelte';

	interface Props {
		party: Party;
		storedPin: string;
	}

	const { party, storedPin }: Props = $props();

	// Initialized from the party once. A realtime party update must NOT clobber
	// the host's unsaved edits, so these never re-derive from `party`.
	function initial() {
		return {
			eventName: party.event_name,
			kickoffInput: toDatetimeLocalValue(party.kickoff_at),
			rowTeam: toTeamSelection(party.team_row_name, party.team_row_color),
			colTeam: toTeamSelection(party.team_col_name, party.team_col_color),
		};
	}
	const start = initial();
	let eventName = $state(start.eventName);
	let kickoffInput = $state(start.kickoffInput);
	let rowTeam = $state(start.rowTeam);
	let colTeam = $state(start.colTeam);
	let isUpdatingDetails = $state(false);
	let kickoffTimeZone = $state('local time');

	onMount(() => {
		kickoffTimeZone = getLocalTimeZoneLabel();
	});

	const isValid = $derived(
		isValidEventName(eventName) && isValidMatchup(rowTeam.name, colTeam.name)
	);
	const kickoffPreview = $derived(formatKickoffPreview(kickoffInput));
	const hasChanges = $derived(
		eventName.trim() !== party.event_name ||
			datetimeLocalToIso(kickoffInput) !== party.kickoff_at ||
			rowTeam.name.trim() !== party.team_row_name ||
			colTeam.name.trim() !== party.team_col_name ||
			rowTeam.color !== party.team_row_color ||
			colTeam.color !== party.team_col_color
	);

	async function handleSave() {
		if (!isValid) return;

		isUpdatingDetails = true;

		const result = await updatePartyDetails(storedPin, {
			eventName: eventName.trim(),
			kickoffAt: datetimeLocalToIso(kickoffInput),
			teamRowName: rowTeam.name.trim(),
			teamColName: colTeam.name.trim(),
			teamRowColor: rowTeam.color,
			teamColColor: colTeam.color,
		});

		if (result.success) {
			toast.success('Party details updated!');
		} else {
			toast.error(result.error || 'Failed to update party details');
		}

		isUpdatingDetails = false;
	}
</script>

<div class="card">
	<h2 class="text-lg font-semibold mb-4">Event Details</h2>
	<p class="text-sm mb-4 text-secondary">
		Keep the shared party page accurate if the matchup, event title, or kickoff time changes before
		the grid is locked.
	</p>

	<div class="space-y-4">
		<label class="block">
			<span class="text-sm text-secondary">Event name</span>
			<input
				type="text"
				bind:value={eventName}
				class="input mt-1"
				maxlength={MAX_EVENT_NAME_LENGTH}
				autocomplete="off"
				onblur={() => (eventName = eventName.trim())}
			/>
		</label>

		<label class="block">
			<span class="text-sm text-secondary">Kickoff time</span>
			<span class="text-xs ml-1 text-muted">(optional)</span>
			<input type="datetime-local" bind:value={kickoffInput} class="input mt-1" />
		</label>
		<p class="text-xs text-muted">Timezone: {kickoffTimeZone}</p>
		{#if kickoffPreview}
			<p class="text-sm text-secondary">Kickoff: {kickoffPreview}</p>
		{/if}

		<TeamMatchupPicker
			bind:row={rowTeam}
			bind:col={colTeam}
			idPrefix="admin-team"
			title="Matchup"
			class="space-y-3"
			pickersClass="space-y-3"
			nameLabelClass="mt-2"
		/>
	</div>

	<button
		onclick={handleSave}
		class="btn btn-primary w-full mt-4"
		disabled={isUpdatingDetails || !isValid || !hasChanges}
	>
		{isUpdatingDetails ? 'Saving...' : 'Save Event Details'}
	</button>
</div>
