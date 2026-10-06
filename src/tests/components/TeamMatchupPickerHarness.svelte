<script lang="ts">
	import TeamMatchupPicker from '$lib/components/forms/TeamMatchupPicker.svelte';
	import { toTeamSelection } from '$lib/utils/partyForm';

	interface Props {
		rowName: string;
		colName: string;
	}

	const { rowName, colName }: Props = $props();

	// Hosts the picker the way the pages do: parent-owned reactive state, bound in.
	// svelte-ignore state_referenced_locally
	let row = $state(toTeamSelection(rowName, '#111111'));
	// svelte-ignore state_referenced_locally
	let col = $state(toTeamSelection(colName, '#222222'));
</script>

<TeamMatchupPicker bind:row bind:col idPrefix="t" title="Matchup" />
<output data-testid="harness-state">{JSON.stringify({ row, col })}</output>
