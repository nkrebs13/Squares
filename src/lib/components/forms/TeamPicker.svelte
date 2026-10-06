<script lang="ts">
	/* eslint-disable prefer-const -- $bindable props are written through bind:, which prefer-const cannot see */
	import { NFL_TEAM_PRESETS, findNflTeamPreset } from '$lib/nflTeams';

	type TeamPickerVariant = 'create' | 'admin';

	interface Props {
		/** Which side of the grid this team scores on. */
		side: 'row' | 'col';
		/** Unique per instance — prefixes every generated id so two pickers can share a page. */
		idPrefix: string;
		name: string;
		color: string;
		/** Selected NFL preset id, or '' for a custom team. */
		presetId: string;
		/** 'create' = compact uppercase labels; 'admin' = inline sentence-case labels. */
		variant?: TeamPickerVariant;
		placeholder?: string;
	}

	let {
		side,
		idPrefix,
		name = $bindable(),
		color = $bindable(),
		presetId = $bindable(),
		variant = 'create',
		placeholder,
	}: Props = $props();

	const sideLabel = $derived(side === 'row' ? 'Left' : 'Top');
	const isCreate = $derived(variant === 'create');
	const labelClass = $derived(
		isCreate ? 'text-xs uppercase tracking-wide text-muted' : 'text-sm text-secondary'
	);
	const nameLabelMargin = $derived(isCreate ? '' : 'mt-2');
	const maxLength = $derived(isCreate ? 30 : 50);

	function applyPreset(teamId: string) {
		const preset = findNflTeamPreset(teamId);
		if (!preset) return;
		name = preset.name;
		color = preset.color;
		presetId = preset.id;
	}
</script>

<div class="flex items-center gap-3">
	<label class="relative cursor-pointer shrink-0" aria-label="{sideLabel} team color">
		<span
			class="block w-9 h-9 rounded-full border-2 border-white/20 shadow-inner"
			style="background: {color}"
		></span>
		<input
			id="{idPrefix}-color"
			type="color"
			bind:value={color}
			class="sr-only"
			aria-label="{sideLabel} team color picker"
			oninput={() => (presetId = '')}
		/>
	</label>
	<div class="flex-1">
		<label class="block">
			<span class={labelClass}>{isCreate ? 'NFL preset' : `${sideLabel} team NFL preset`}</span>
			<select
				id="{idPrefix}-preset"
				bind:value={presetId}
				class="input mt-1"
				aria-label="{sideLabel} team NFL preset"
				onchange={(event) => applyPreset((event.currentTarget as HTMLSelectElement).value)}
			>
				<option value="">Custom {sideLabel.toLowerCase()} team</option>
				{#each NFL_TEAM_PRESETS as team (team.id)}
					<option value={team.id}>{team.name}</option>
				{/each}
			</select>
		</label>
		<label class="block {nameLabelMargin}">
			<span class={labelClass}>{sideLabel} Team</span>
			<input
				id="{idPrefix}-name"
				type="text"
				bind:value={name}
				{placeholder}
				class="input mt-1"
				maxlength={maxLength}
				oninput={() => (presetId = '')}
				onblur={() => (name = name.trim())}
			/>
		</label>
	</div>
</div>
