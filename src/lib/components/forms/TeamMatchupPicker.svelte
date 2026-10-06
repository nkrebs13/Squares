<script lang="ts" module>
	export interface TeamSelection {
		name: string;
		color: string;
		/** Selected NFL preset id, or '' for a custom team. */
		presetId: string;
	}
</script>

<script lang="ts">
	/* eslint-disable prefer-const -- $bindable props are written through bind:, which prefer-const cannot see */
	import TeamPicker from './TeamPicker.svelte';
	import { areDistinctTeamNames } from '$lib/utils/teamNames';

	interface Props {
		row: TeamSelection;
		col: TeamSelection;
		/** Prefix for generated ids — keeps two pickers on one page unique. */
		idPrefix: string;
		variant?: 'create' | 'admin';
	}

	let { row = $bindable(), col = $bindable(), idPrefix, variant = 'create' }: Props = $props();

	const isCreate = $derived(variant === 'create');
	const rowName = $derived(row.name.trim());
	const colName = $derived(col.name.trim());
	const bothNamed = $derived(rowName.length > 0 && colName.length > 0);
	const hasDistinctTeams = $derived(areDistinctTeamNames(row.name, col.name));

	function swapTeams() {
		const previousRow = { name: row.name, color: row.color, presetId: row.presetId };
		row.name = col.name;
		row.color = col.color;
		row.presetId = col.presetId;
		col.name = previousRow.name;
		col.color = previousRow.color;
		col.presetId = previousRow.presetId;
	}
</script>

{#snippet pickers()}
	<TeamPicker
		side="row"
		idPrefix="{idPrefix}-row"
		bind:name={row.name}
		bind:color={row.color}
		bind:presetId={row.presetId}
		{variant}
		placeholder={isCreate ? 'e.g. Chiefs' : undefined}
	/>
	<TeamPicker
		side="col"
		idPrefix="{idPrefix}-col"
		bind:name={col.name}
		bind:color={col.color}
		bind:presetId={col.presetId}
		{variant}
		placeholder={isCreate ? 'e.g. Eagles' : undefined}
	/>
{/snippet}

{#if isCreate}
	<div class="flex items-center justify-between gap-3">
		<span class="text-sm text-secondary">Teams</span>
		<button type="button" class="btn btn-secondary text-sm" onclick={swapTeams}> Swap </button>
	</div>
	<p class="text-xs mt-1 text-muted">
		Set the teams playing — scores run left ↕ for the Left Team, top ↔ for the Top Team
	</p>
	<div class="mt-4 space-y-4">
		{@render pickers()}
	</div>
{:else}
	<div class="space-y-3">
		<div class="flex items-center justify-between gap-3">
			<span class="text-sm text-secondary">Matchup</span>
			<button type="button" class="btn btn-secondary text-sm" onclick={swapTeams}> Swap </button>
		</div>
		{@render pickers()}
	</div>
{/if}
{#if bothNamed && !hasDistinctTeams}
	<p class="{isCreate ? 'mt-3 ' : ''}text-sm" style="color: #fca5a5">
		Choose two different teams for the matchup.
	</p>
{/if}
{#if bothNamed && hasDistinctTeams}
	<div class="{isCreate ? 'mt-4 ' : ''}rounded-lg border border-white/10 p-3">
		<div class="text-xs uppercase tracking-wide text-muted">Matchup preview</div>
		<div class="mt-1 font-semibold">{rowName} vs {colName}</div>
		<div class="mt-1 text-xs text-muted">
			{rowName} uses left-side score digits; {colName} uses top score digits.
		</div>
	</div>
{/if}
