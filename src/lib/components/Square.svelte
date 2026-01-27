<script lang="ts">
	import { userName, normalizePlayerName } from '$lib/stores/user';
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
		winner?: Winner | null;
		onpointerdown?: (e: PointerEvent) => void;
		onpointerenter?: () => void;
		onpointerup?: () => void;
	}

	let {
		square,
		size = 44,
		rowNumber,
		colNumber,
		isLocked,
		isSelected = false,
		isPressed = false,
		pressProgress = 0,
		winner = null,
		onpointerdown,
		onpointerenter,
		onpointerup
	}: Props = $props();

	// Get initials from a name (e.g., "John Doe" -> "JD", "john" -> "J")
	function getInitials(name: string): string {
		const parts = name.trim().split(/\s+/);
		if (parts.length >= 2) {
			return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
		}
		return name.substring(0, 2).toUpperCase();
	}

	// Predefined color palette for 15 distinct players
	// Optimized for: WCAG AA contrast (4.5:1+), colorblind accessibility, visual distinction
	const playerColors = [
		// Primary - widely spaced hues (60°+ apart)
		{ bg: 'rgba(100, 180, 255, 0.22)', text: 'rgba(120, 190, 255, 0.95)' },   // Blue (210°)
		{ bg: 'rgba(255, 110, 110, 0.22)', text: 'rgba(255, 130, 130, 0.95)' },   // Red (0°)
		{ bg: 'rgba(100, 230, 100, 0.22)', text: 'rgba(120, 240, 120, 0.95)' },   // Green (120°)
		{ bg: 'rgba(255, 230, 100, 0.22)', text: 'rgba(255, 235, 130, 0.98)' },   // Yellow (50°) - brightened
		{ bg: 'rgba(180, 100, 255, 0.22)', text: 'rgba(190, 120, 255, 0.95)' },   // Violet (270°)

		// Secondary - fill hue gaps
		{ bg: 'rgba(255, 150, 80, 0.22)', text: 'rgba(255, 170, 110, 0.98)' },    // Orange (30°) - brightened
		{ bg: 'rgba(100, 230, 230, 0.22)', text: 'rgba(120, 240, 240, 0.95)' },   // Cyan (180°)
		{ bg: 'rgba(255, 100, 170, 0.22)', text: 'rgba(255, 130, 185, 0.95)' },   // Magenta (330°)
		{ bg: 'rgba(190, 255, 100, 0.22)', text: 'rgba(200, 255, 130, 0.98)' },   // Chartreuse (80°) - brightened
		{ bg: 'rgba(255, 130, 220, 0.22)', text: 'rgba(255, 150, 230, 0.95)' },   // Hot Pink (315°)

		// Tertiary - remaining gaps with distinct saturation/lightness
		{ bg: 'rgba(100, 255, 190, 0.22)', text: 'rgba(120, 255, 200, 0.95)' },   // Spring Green (150°)
		{ bg: 'rgba(230, 190, 150, 0.22)', text: 'rgba(245, 210, 175, 0.98)' },   // Tan/Bronze (30°) - brightened
		{ bg: 'rgba(130, 200, 200, 0.22)', text: 'rgba(150, 220, 220, 0.95)' },   // Teal (180°)
		{ bg: 'rgba(200, 160, 255, 0.22)', text: 'rgba(210, 175, 255, 0.95)' },   // Lavender (265°)
		{ bg: 'rgba(255, 200, 150, 0.22)', text: 'rgba(255, 215, 175, 0.98)' },   // Apricot/Peach (35°) - brightened
	];

	function getPlayerColor(name: string): { bg: string; text: string } {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return playerColors[Math.abs(hash) % playerColors.length];
	}

	let isMine = $derived(
		$userName && square.player_name_lower === normalizePlayerName($userName)
	);

	let isWinner = $derived(winner !== null);

	let initials = $derived(
		square.player_name ? getInitials(square.player_name) : ''
	);

	let playerColor = $derived(
		square.player_name && !isMine ? getPlayerColor(square.player_name) : null
	);

	let classes = $derived(
		`square ${!square.player_name ? 'square-empty' : ''} ${isMine ? 'square-mine' : square.player_name ? 'square-claimed' : ''} ${isWinner ? 'square-winner' : ''} ${isSelected ? 'square-selected' : ''} ${isPressed ? 'square-pressed' : ''}`
	);

	// Progress ring calculation - scales with button size
	// Ring is 82% of button size (leaves margin for stroke width)
	let ringRadius = $derived(size * 0.41);
	let ringCircumference = $derived(2 * Math.PI * ringRadius);
	let strokeDashoffset = $derived(ringCircumference * (1 - pressProgress));
	let ringCenter = $derived(size / 2);

	// Scale animation based on progress (0.97 at start, 0.99 near complete)
	let pressScale = $derived(isPressed ? 0.97 + (pressProgress * 0.02) : 1);

	// Comprehensive aria-label including position and state
	let ariaLabel = $derived(() => {
		const position = rowNumber !== undefined && colNumber !== undefined
			? `Row ${rowNumber}, Column ${colNumber}. `
			: '';

		if (isWinner) {
			return `${position}Winning square claimed by ${square.player_name || 'unknown player'}.`;
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
	style="width: {size}px; height: {size}px; min-width: {size}px; min-height: {size}px; {playerColor && !isWinner ? `background: ${playerColor.bg}; border-color: ${playerColor.text.replace(/0\.9[58]/g, '0.35')};` : ''} {isPressed ? `transform: scale(${pressScale});` : ''}"
	onpointerdown={onpointerdown}
	onpointerenter={onpointerenter}
	onpointerup={onpointerup}
	disabled={isLocked || (square.player_name !== null && !isMine)}
	aria-label={ariaLabel()}
	aria-selected={isSelected}
	title={square.player_name || undefined}
>
	{#if initials}
		<span
			class="font-bold text-xs"
			style={playerColor && !isWinner && !isMine ? `color: ${playerColor.text}` : ''}
		>
			{initials}
		</span>
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
</style>
