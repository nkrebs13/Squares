<script lang="ts">
	import { onMount } from 'svelte';
	import { updatePartyDetails } from '$lib/stores/game';
	import { toast } from '$lib/stores/toast';
	import { APP_CONFIG } from '$lib/config';
	import { findNflTeamPresetId } from '$lib/nflTeams';
	import type { Party } from '$lib/types';
	import {
		datetimeLocalToIso,
		getLocalTimeZoneLabel,
		toDatetimeLocalValue,
	} from '$lib/utils/datetime';
	import { formatKickoffPreview, isValidEventName, isValidMatchup } from '$lib/utils/partyForm';
	import TeamMatchupPicker, {
		type TeamSelection,
	} from '$lib/components/forms/TeamMatchupPicker.svelte';

	interface Props {
		party: Party;
		storedPin: string;
	}

	const { party, storedPin }: Props = $props();

	let eventName = $state('');
	let kickoffInput = $state('');
	let rowTeam = $state<TeamSelection>({
		name: '',
		color: APP_CONFIG.defaultTeams.row.color,
		presetId: '',
	});
	let colTeam = $state<TeamSelection>({
		name: '',
		color: APP_CONFIG.defaultTeams.col.color,
		presetId: '',
	});
	let isUpdatingDetails = $state(false);
	let kickoffTimeZone = $state('local time');

	onMount(() => {
		kickoffTimeZone = getLocalTimeZoneLabel();
	});

	// Initialize from party data once. After the host starts editing, a realtime
	// party update must NOT clobber their unsaved work.
	let initialized = $state(false);
	$effect(() => {
		if (!initialized) {
			eventName = party.event_name;
			kickoffInput = toDatetimeLocalValue(party.kickoff_at);
			rowTeam.name = party.team_row_name;
			rowTeam.color = party.team_row_color;
			rowTeam.presetId = findNflTeamPresetId(party.team_row_name, party.team_row_color);
			colTeam.name = party.team_col_name;
			colTeam.color = party.team_col_color;
			colTeam.presetId = findNflTeamPresetId(party.team_col_name, party.team_col_color);
			initialized = true;
		}
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
				maxlength="80"
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
			variant="admin"
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
