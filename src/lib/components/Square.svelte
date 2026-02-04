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
		isPressed?: boolean;
		pressProgress?: number;
		isPending?: boolean;
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
		isPressed = false,
		pressProgress = 0,
		isPending = false,
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
		`square ${!square.player_name ? 'square-empty' : ''} ${isMine ? 'square-mine' : square.player_name ? 'square-claimed' : ''} ${isWinner ? 'square-winner' : ''} ${isSelected ? 'square-selected' : ''} ${isPressed ? 'square-pressed' : ''} ${isPending ? 'square-pending' : ''}`
	);

	// Progress ring calculation - scales with button size
	// Ring is 82% of button size (leaves margin for stroke width)
	const ringRadius = $derived(size * 0.41);
	const ringCircumference = $derived(2 * Math.PI * ringRadius);
	const strokeDashoffset = $derived(ringCircumference * (1 - pressProgress));
	const ringCenter = $derived(size / 2);

	// Scale animation based on progress (0.97 at start, 0.99 near complete)
	const pressScale = $derived(isPressed ? 0.97 + pressProgress * 0.02 : 1);

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
		: ''} {isPressed ? `transform: scale(${pressScale});` : ''}"
	{onpointerdown}
	{onpointerenter}
	{onpointerup}
	disabled={isLocked || (square.player_name !== null && !isMine)}
	aria-label={ariaLabel()}
	aria-selected={isSelected}
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

	<!-- Progress ring for long-press feedback - scales with button size -->
	{#if isPressed && pressProgress > 0}
		<svg class="progress-ring" viewBox="0 0 {size} {size}">
			<circle
				class="progress-ring-circle"
				cx={ringCenter}
				cy={ringCenter}
				r={ringRadius}
				stroke-dasharray={ringCircumference}
				stroke-dashoffset={strokeDashoffset}
			/>
		</svg>
	{/if}
</button>

<style>
	.square-pressed {
		/* Neutral white overlay with increased visibility for pressed state */
		background: rgba(255, 255, 255, 0.18) !important;
		border-color: rgba(255, 255, 255, 0.4) !important;
	}

	.progress-ring {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		pointer-events: none;
		transform: rotate(-90deg);
	}

	.progress-ring-circle {
		fill: none;
		/* Pure white ring provides maximum contrast against ALL player colors
		   and is equally visible for all forms of color blindness */
		stroke: rgba(255, 255, 255, 0.95);
		stroke-width: 4;
		stroke-linecap: round;
		transition: stroke-dashoffset 50ms linear;
		filter: drop-shadow(0 0 4px rgba(255, 255, 255, 0.5));
	}

	/* Reduced motion preference */
	@media (prefers-reduced-motion: reduce) {
		.progress-ring-circle {
			transition: none;
		}
	}

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
