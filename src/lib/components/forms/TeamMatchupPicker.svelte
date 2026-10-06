<script lang="ts">
	import TeamPicker from './TeamPicker.svelte';
	import { isValidMatchup, type TeamSelection } from '$lib/utils/partyForm';

	interface Props {
		row: TeamSelection;
		col: TeamSelection;
		/** Prefix for generated ids — keeps two pickers on one page unique. */
		idPrefix: string;
		/** Heading shown beside the Swap button. */
		title: string;
		helpText?: string;
		/** Placeholders for the [left, top] team name inputs. */
		placeholders?: [string, string];
		/** Forwarded to both pickers; see TeamPicker. */
		presetLabel?: string;
		labelClass?: string;
		nameLabelClass?: string;
		nameMaxLength?: number;
		/** Classes for the container holding the heading and the pickers. */
		class?: string;
		/** Classes for the wrapper around the two pickers. */
		pickersClass?: string;
		/** Classes for the same-team warning and the matchup preview. */
		feedbackClass?: string;
	}

	let {
		row = $bindable(),
		col = $bindable(),
		idPrefix,
		title,
		helpText,
		placeholders,
		presetLabel,
		labelClass,
		nameLabelClass,
		nameMaxLength,
		class: className = '',
		pickersClass = '',
		feedbackClass = '',
	}: Props = $props();

	const rowName = $derived(row.name.trim());
	const colName = $derived(col.name.trim());
	const bothNamed = $derived(rowName.length > 0 && colName.length > 0);
	const isDistinct = $derived(isValidMatchup(row.name, col.name));

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

<div class={className}>
	<div class="flex items-center justify-between gap-3">
		<span class="text-sm text-secondary">{title}</span>
		<button type="button" class="btn btn-secondary text-sm" onclick={swapTeams}> Swap </button>
	</div>
	{#if helpText}
		<p class="text-xs mt-1 text-muted">{helpText}</p>
	{/if}
	<div class={pickersClass}>
		<TeamPicker
			side="row"
			idPrefix="{idPrefix}-row"
			bind:name={row.name}
			bind:color={row.color}
			bind:presetId={row.presetId}
			{presetLabel}
			{labelClass}
			{nameLabelClass}
			{nameMaxLength}
			placeholder={placeholders?.[0]}
		/>
		<TeamPicker
			side="col"
			idPrefix="{idPrefix}-col"
			bind:name={col.name}
			bind:color={col.color}
			bind:presetId={col.presetId}
			{presetLabel}
			{labelClass}
			{nameLabelClass}
			{nameMaxLength}
			placeholder={placeholders?.[1]}
		/>
	</div>
</div>
{#if bothNamed && !isDistinct}
	<p class="text-sm text-error {feedbackClass}">Choose two different teams for the matchup.</p>
{/if}
{#if bothNamed && isDistinct}
	<div class="rounded-lg border border-white/10 p-3 {feedbackClass}">
		<div class="text-xs uppercase tracking-wide text-muted">Matchup preview</div>
		<div class="mt-1 font-semibold">{rowName} vs {colName}</div>
		<div class="mt-1 text-xs text-muted">
			{rowName} uses left-side score digits; {colName} uses top score digits.
		</div>
	</div>
{/if}
