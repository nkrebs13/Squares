<script lang="ts">
	import { userName, normalizePlayerName } from '$lib/stores/user';
	import { getPlayerColor } from '$lib/utils/colors';
	import type { Square as SquareType, Winner } from '$lib/types';

	interface Props {
		square: SquareType;
		size?: number;
		rowNumber?: number;
		colNumber?: number;
		isLocked: boolean;
		isSelected?: boolean;
		isPending?: boolean;
		isLeading?: boolean;
		winners?: Winner[];
		onpointerdown?: (e: PointerEvent) => void;
		onpointerenter?: () => void;
		onpointerup?: () => void;
	}

	const {
		square,
		size = 44,
		rowNumber,
		colNumber,
		isLocked,
		isSelected = false,
		isPending = false,
		isLeading = false,
		winners = [],
		onpointerdown,
		onpointerenter,
		onpointerup,
	}: Props = $props();

	// Quarter display labels
	const quarterLabels: Record<string, string> = {
		q1: '1',
		q2: '2',
		q3: '3',
		final: 'F',
	};

	// Get initials from a name (e.g., "John Doe" -> "JD", "john" -> "J")
	function getInitials(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		}
		return name.substring(0, 2).toUpperCase();
	}

	const isMine = $derived($userName && square.player_name_lower === normalizePlayerName($userName));

	const isWinner = $derived(winners.length > 0);

	const initials = $derived(square.player_name ? getInitials(square.player_name) : '');

	const playerColor = $derived(square.player_name ? getPlayerColor(square.player_name) : null);

	const classes = $derived(
		`square ${!square.player_name ? 'square-empty' : ''} ${isMine ? 'square-mine' : square.player_name ? 'square-claimed' : ''} ${isWinner ? 'square-winner' : ''} ${isLeading && !isWinner ? 'square-leading' : ''} ${isSelected ? 'square-selected' : ''} ${isPending ? 'square-pending' : ''}`
	);

	// Comprehensive aria-label including position and state
	const ariaLabel = $derived(() => {
		const position =
			rowNumber !== undefined && colNumber !== undefined
				? `Row ${rowNumber}, Column ${colNumber}. `
				: '';

		if (isWinner) {
			const quarters = winners
				.map((w) => (w.quarter === 'final' ? 'Final' : `Q${w.quarter.slice(1)}`))
				.join(', ');
			return `${position}Winner for ${quarters}, claimed by ${square.player_name || 'unknown player'}.`;
		}
		if (isLeading && square.player_name) {
			return `${position}Currently winning square, claimed by ${square.player_name}.`;
		}
		if (isMine) {
			return `${position}Your square. Press to unclaim.`;
		}
		if (square.player_name) {
			return `${position}Claimed by ${square.player_name}.`;
		}
		if (isSelected) {
			return `${position}Empty square, selected for claiming.`;
		}
		return `${position}Empty square. Press to claim or hold to multi-select.`;
	});
</script>

<button
	class={classes}
	style="width: {size}px; height: {size}px; min-width: {size}px; min-height: {size}px; {playerColor &&
	!isWinner
		? `background: ${playerColor.bg}; border-color: ${playerColor.text.replace(/0\.9[58]/g, '0.35')};`
		: ''}{isMine && playerColor
		? ` --mine-outline: ${playerColor.text.replace(/0\.9[58]/g, '0.7')}; --mine-glow: ${playerColor.text.replace(/0\.9[58]/g, '0.25')}; --mine-glow-strong: ${playerColor.text.replace(/0\.9[58]/g, '0.4')};`
		: ''}"
	{onpointerdown}
	{onpointerenter}
	{onpointerup}
	disabled={isLocked || (square.player_name !== null && !isMine)}
	aria-label={ariaLabel()}
	aria-pressed={isSelected}
	title={square.player_name || undefined}
>
	{#if initials}
		<span
			class="font-bold text-xs"
			style={playerColor && !isWinner ? `color: ${playerColor.text}` : ''}
		>
			{initials}
		</span>
	{/if}

	<!-- Quarter badges for winning squares -->
	{#if winners.length > 0}
		<div class="quarter-badges">
			{#each winners as w (w.quarter)}
				<span class="quarter-badge">{quarterLabels[w.quarter]}</span>
			{/each}
		</div>
	{/if}
</button>

<style>
	button {
		position: relative;
		overflow: hidden;
		touch-action: manipulation; /* Prevent 300ms tap delay and double-tap-to-zoom interference */
	}

	.quarter-badges {
		position: absolute;
		bottom: 2px;
		right: 2px;
		display: flex;
		gap: 1px;
	}

	.quarter-badge {
		font-size: 8px;
		font-weight: bold;
		line-height: 1;
		padding: 1px 3px;
		background: rgba(0, 0, 0, 0.5);
		color: white;
		border-radius: 2px;
	}
</style>
