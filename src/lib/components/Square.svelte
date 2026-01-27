<script lang="ts">
	import { userName, normalizePlayerName } from '$lib/stores/user';
	import type { Square as SquareType, Winner } from '$lib/types';

	interface Props {
		square: SquareType;
		rowNumber?: number;
		colNumber?: number;
		isLocked: boolean;
		isSelected?: boolean;
		winner?: Winner | null;
		onclick: () => void;
		onpointerdown?: (e: PointerEvent) => void;
		onpointerenter?: () => void;
	}

	let {
		square,
		rowNumber,
		colNumber,
		isLocked,
		isSelected = false,
		winner = null,
		onclick,
		onpointerdown,
		onpointerenter
	}: Props = $props();

	let isMine = $derived(
		$userName && square.player_name_lower === normalizePlayerName($userName)
	);

	let isWinner = $derived(winner !== null);

	let displayName = $derived(
		square.player_name
			? square.player_name.length > 8
				? square.player_name.substring(0, 7) + '…'
				: square.player_name
			: ''
	);

	let classes = $derived(
		`square ${!square.player_name ? 'square-empty' : ''} ${isMine ? 'square-mine' : square.player_name ? 'square-claimed' : ''} ${isWinner ? 'square-winner' : ''} ${isSelected ? 'square-selected' : ''}`
	);
</script>

<button
	class={classes}
	onclick={onclick}
	onpointerdown={onpointerdown}
	onpointerenter={onpointerenter}
	disabled={isLocked || (square.player_name !== null && !isMine)}
	aria-label={square.player_name ? `Square claimed by ${square.player_name}` : 'Empty square'}
>
	{#if displayName}
		<span class="truncate px-0.5">{displayName}</span>
	{/if}
</button>
