<script lang="ts">
	import { onMount } from 'svelte';
	import { APP_CONFIG } from '$lib/config';
	import { MAX_EVENT_NAME_LENGTH } from '$lib/constants';
	import { getLocalTimeZoneLabel } from '$lib/utils/datetime';
	import { formatKickoffPreview } from '$lib/utils/partyForm';

	// Event name + kickoff, shared by the create page and the admin event card.
	interface Props {
		eventName: string;
		/** A `datetime-local` value ('' when unset). */
		kickoffInput: string;
	}

	let { eventName = $bindable(), kickoffInput = $bindable() }: Props = $props();

	// The server renders a neutral label; the browser fills in its real zone.
	let timeZone = $state('local time');
	onMount(() => {
		timeZone = getLocalTimeZoneLabel();
	});

	const kickoffPreview = $derived(formatKickoffPreview(kickoffInput));
</script>

<div class="space-y-4">
	<label class="block">
		<span class="text-sm text-secondary">Event name</span>
		<input
			type="text"
			bind:value={eventName}
			placeholder="e.g. 2027 Super Bowl"
			class="input mt-1"
			maxlength={MAX_EVENT_NAME_LENGTH}
			autocomplete="off"
			onblur={() => (eventName = eventName.trim() || APP_CONFIG.defaultEventName)}
		/>
	</label>

	<div>
		<label class="block">
			<span class="text-sm text-secondary">Kickoff time</span>
			<span class="text-xs ml-1 text-muted">(optional)</span>
			<input type="datetime-local" bind:value={kickoffInput} class="input mt-1" />
		</label>
		<p class="mt-1 text-xs text-muted">Timezone: {timeZone}</p>
		{#if kickoffPreview}
			<p class="mt-1 text-sm text-secondary">Kickoff: {kickoffPreview}</p>
		{/if}
	</div>
</div>
