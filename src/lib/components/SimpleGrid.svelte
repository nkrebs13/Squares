<script lang="ts">
	import { canActOnGrid, isFilling } from '$lib/partyStatus';
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import { MediaQuery } from 'svelte/reactivity';
	import { DESKTOP_LAYOUT_QUERY } from '$lib/layout';
	import Square from './Square.svelte';
	import PlayerLegend from './PlayerLegend.svelte';
	import ZoomToggle from './ZoomToggle.svelte';
	import {
		squares,
		numbers,
		party,
		winners,
		claimSquareOptimistic,
		claimSquaresBatchOptimistic,
		unclaimSquareOptimistic,
		pendingOperations,
		mySquareCount,
		amountOwed,
		activePlayerFilter,
		leadingSquare,
		teamTheme,
	} from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import { normalizePlayerName } from '$lib/utils/playerName';
	import { formatPrice } from '$lib/utils/format';
	import { getPlayerColor } from '$lib/utils/colors';
	import { APP_CONFIG } from '$lib/config';
	import { GRID_SIZE } from '$lib/constants';
	import { DragSelect } from '$lib/utils/dragSelect.svelte';
	import { squareKey } from '$lib/utils/squareKey';
	import {
		buildSquareMap,
		buildWinnerMap,
		GAP_SIZE,
		getEffectiveCellSize,
		getFitCellSize,
		getHeaderHeight,
		shouldShowZoomControl,
		type ZoomState,
	} from '$lib/utils/gridLayout';
	import type { Square as SquareType, Winner } from '$lib/types';

	let scrollContainer: HTMLDivElement;

	// The scroll container's content width: what the 11 columns have to fit in.
	let containerWidth = $state(0);
	let zoomState = $state<ZoomState>('fit');
	const desktop = new MediaQuery(DESKTOP_LAYOUT_QUERY);

	// Pointer drag-select (see $lib/utils/dragSelect.svelte.ts)
	const drag = new DragSelect({
		canInteract: () => canAct,
		canSelectCell,
		onCellClick: handleSquareClick,
		onBatch: (cells) => claimSquaresBatchOptimistic(cells),
	});

	let resizeObserver: ResizeObserver | null = null;

	const filling = $derived(isFilling($party?.status));
	const canAct = $derived(canActOnGrid($party?.status, $userName));
	const myName = $derived($userName ? normalizePlayerName($userName) : null);

	const fitCellSize = $derived(getFitCellSize(containerWidth));
	// The minimum cell size can make the grid wider than a narrow phone; then it
	// scrolls instead of clipping the right-hand column.
	const fitsWithoutScroll = $derived(
		(GRID_SIZE + 1) * fitCellSize + GRID_SIZE * GAP_SIZE <= containerWidth
	);
	const effectiveCellSize = $derived(getEffectiveCellSize(zoomState, fitCellSize));
	const showZoomControl = $derived(shouldShowZoomControl(fitCellSize));
	const headerHeight = $derived(getHeaderHeight(effectiveCellSize));

	const squareMap = $derived(buildSquareMap($squares));
	const winnerMap = $derived(buildWinnerMap($winners, !!$numbers));

	function getSquare(row: number, col: number): SquareType | undefined {
		return squareMap.get(squareKey(row, col));
	}

	function getWinners(row: number, col: number): Winner[] {
		return winnerMap.get(squareKey(row, col)) || [];
	}

	function canSelectCell(row: number, col: number): boolean {
		if (!canAct) return false;
		const square = getSquare(row, col);
		return square !== undefined && square.player_name === null;
	}

	function isMine(square: SquareType): boolean {
		return myName !== null && square.player_name_lower === myName;
	}

	function isSquareHighlighted(square: SquareType): boolean {
		if (!$activePlayerFilter) return false;
		return square.player_name_lower === $activePlayerFilter;
	}

	function isSquareDimmed(square: SquareType): boolean {
		if (!$activePlayerFilter) return false;
		return square.player_name_lower !== $activePlayerFilter;
	}

	function handleSquareClick(row: number, col: number) {
		if (!canAct) return;

		const square = getSquare(row, col);
		if (!square) return;

		if (isMine(square)) {
			unclaimSquareOptimistic(row, col);
		} else if (!square.player_name) {
			claimSquareOptimistic(row, col);
		}
	}

	function handleSquareKeyboardClick(row: number, col: number, e: MouseEvent) {
		if (e.detail !== 0) return;
		handleSquareClick(row, col);
	}

	function isSquarePending(row: number, col: number): boolean {
		return $pendingOperations.has(squareKey(row, col));
	}

	onMount(() => {
		if (!browser || !scrollContainer) return;
		resizeObserver = new ResizeObserver(([entry]) => {
			containerWidth = entry.contentRect.width;
		});
		resizeObserver.observe(scrollContainer);
	});

	onDestroy(() => resizeObserver?.disconnect());

	const myColor = $derived($userName ? getPlayerColor($userName) : null);

	const rows = Array.from({ length: GRID_SIZE }, (_, i) => i);
	const cols = Array.from({ length: GRID_SIZE }, (_, i) => i);

	const showColLogo = $derived(
		$teamTheme.colName?.toLowerCase().trim() ===
			APP_CONFIG.defaultTeams.col.name.toLowerCase().trim()
	);
	const showRowLogo = $derived(
		$teamTheme.rowName?.toLowerCase().trim() ===
			APP_CONFIG.defaultTeams.row.name.toLowerCase().trim()
	);
</script>

<svelte:window
	onpointerup={() => drag.globalPointerUp()}
	onpointercancel={() => drag.globalPointerCancel()}
/>

{#snippet teamLogo(src: string)}
	<img
		{src}
		alt=""
		aria-hidden="true"
		class="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain drop-shadow-lg"
		onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
	/>
{/snippet}

<div class="space-y-4">
	{#if $userName}
		<div class="stats-bar">
			<div class="flex items-center gap-2">
				<span class="text-sm text-secondary">Your squares:</span>
				<span class="font-bold text-lg">{$mySquareCount}</span>
			</div>
			{#if $party && $party.square_price > 0}
				<div class="flex items-center gap-2">
					<span class="text-sm text-secondary">You owe:</span>
					<span class="font-bold text-lg" style="color: var(--color-accent)"
						>{formatPrice($amountOwed)}</span
					>
				</div>
			{/if}
		</div>
	{/if}

	<div class="grid-wrapper">
		<div class="team-label-col">
			{#if showColLogo}
				{@render teamLogo(APP_CONFIG.defaultTeams.col.logoUrl)}
			{/if}
			<span
				class="team-name font-bold text-xl sm:text-2xl md:text-3xl"
				style="color: {$teamTheme.colColor}"
			>
				{$teamTheme.colName}
			</span>
		</div>

		<div class="grid-with-row-label">
			<div class="team-label-row">
				<span
					class="team-name font-bold text-base sm:text-lg md:text-xl writing-vertical flex items-center"
					style="color: {$teamTheme.rowColor}"
				>
					{$teamTheme.rowName}
				</span>
				{#if showRowLogo}
					{@render teamLogo(APP_CONFIG.defaultTeams.row.logoUrl)}
				{/if}
			</div>

			<div
				class="scroll-container"
				class:fit-mode={zoomState === 'fit' && fitsWithoutScroll}
				bind:this={scrollContainer}
				style="--cell-size: {effectiveCellSize}px; --header-height: {headerHeight}px; --grid-gap: {GAP_SIZE}px;"
			>
				<div
					class="grid-11x11"
					role="grid"
					aria-label="{APP_CONFIG.gridLabel}, {GRID_SIZE} by {GRID_SIZE}."
					aria-rowcount={GRID_SIZE + 1}
					aria-colcount={GRID_SIZE + 1}
				>
					<div class="corner-cell" role="presentation"></div>

					{#each cols as col (col)}
						<div
							class="col-header team-col-bg {col === 0 ? 'rounded-tl' : ''} {col === GRID_SIZE - 1
								? 'rounded-tr'
								: ''}"
							role="columnheader"
							aria-colindex={col + 2}
						>
							{$numbers ? $numbers.col_numbers[col] : '?'}
						</div>
					{/each}

					{#each rows as row (row)}
						<div
							class="row-header team-row-bg {row === 0 ? 'rounded-tl' : ''} {row === GRID_SIZE - 1
								? 'rounded-bl'
								: ''}"
							role="rowheader"
							aria-rowindex={row + 2}
						>
							{$numbers ? $numbers.row_numbers[row] : '?'}
						</div>

						{#each cols as col (col)}
							{@const square = getSquare(row, col)}
							{#if square}
								<div
									class="square-wrapper"
									class:highlighted={isSquareHighlighted(square)}
									class:dimmed={isSquareDimmed(square)}
									role="gridcell"
									aria-rowindex={row + 2}
									aria-colindex={col + 2}
								>
									<Square
										{square}
										size={effectiveCellSize}
										rowNumber={$numbers?.row_numbers[row]}
										colNumber={$numbers?.col_numbers[col]}
										isMine={isMine(square)}
										isLocked={!filling}
										isSelected={drag.selectedCells.has(squareKey(row, col))}
										isPending={isSquarePending(row, col)}
										isLeading={$leadingSquare?.row === row && $leadingSquare?.col === col}
										winners={getWinners(row, col)}
										onpointerdown={(e) => drag.pointerDown(row, col, e)}
										onpointerenter={() => drag.pointerEnter(row, col)}
										onpointerup={() => drag.pointerUp(row, col)}
										onclick={(e) => handleSquareKeyboardClick(row, col, e)}
									/>
								</div>
							{/if}
						{/each}
					{/each}
				</div>
			</div>
		</div>
	</div>

	<div class="grid-control-center">
		<div class="control-top-row">
			<div class="legend-items">
				<div class="legend-item">
					<div class="legend-swatch legend-available"></div>
					<span>Available</span>
				</div>
				{#if $userName && myColor}
					<div class="legend-item">
						<div
							class="legend-swatch legend-mine"
							style="background: {myColor.bg}; border-color: {myColor.textAt(
								0.5
							)}; outline-color: {myColor.textAt(0.7)};"
						></div>
						<span>Yours</span>
					</div>
				{/if}
				<div class="legend-item">
					<div class="legend-swatch legend-winner"></div>
					<span>Winner</span>
				</div>
				{#if $leadingSquare}
					<div class="legend-item">
						<div class="legend-swatch legend-leading"></div>
						<span>Leading</span>
					</div>
				{/if}
			</div>

			{#if showZoomControl}
				<ZoomToggle
					{zoomState}
					ontoggle={() => (zoomState = zoomState === 'fit' ? 'zoomed' : 'fit')}
				/>
			{/if}
		</div>

		{#if !desktop.current}
			<PlayerLegend collapsible />
		{/if}
	</div>

	{#if drag.isDragging && drag.selectedCells.size > 0}
		<div class="selection-indicator">
			{`${drag.selectedCells.size} squares`}
		</div>
	{/if}
</div>

<style>
	.writing-vertical {
		writing-mode: vertical-rl;
		text-orientation: mixed;
		transform: rotate(180deg);
	}

	.grid-wrapper {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.team-label-col {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 0.75rem 0;
	}

	.grid-with-row-label {
		display: flex;
		gap: 0.25rem;
	}

	.team-label-row {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.25rem;
		padding: 0.25rem 0;
		flex-shrink: 0;
		width: 48px;
	}

	.team-name {
		text-shadow:
			0 0 10px currentColor,
			0 1px 3px rgba(0, 0, 0, 0.8);
	}

	.scroll-container {
		flex: 1;
		overflow-x: auto;
		overflow-y: hidden;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior-x: contain;
		border-radius: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		padding: 0.25rem;
	}

	.scroll-container.fit-mode {
		overflow-x: hidden;
	}

	/* 10 = GRID_SIZE, 11 = header column + GRID_SIZE (CSS can't import the constant). */
	.grid-11x11 {
		display: grid;
		grid-template-columns: repeat(11, var(--cell-size));
		grid-template-rows: var(--header-height) repeat(10, var(--cell-size));
		gap: var(--grid-gap);
		width: fit-content;
	}

	.corner-cell {
		position: sticky;
		left: 0;
		z-index: 20;
		background: var(--bg-secondary);
		width: var(--cell-size);
		height: var(--header-height);
		box-shadow:
			0 0 0 2px var(--bg-secondary),
			-6px 0 0 0 var(--bg-secondary);
	}

	.col-header {
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--cell-size);
		height: var(--header-height);
		font-size: 0.75rem;
		font-weight: bold;
		color: white;
	}

	.row-header {
		position: sticky;
		left: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--cell-size);
		height: var(--cell-size);
		font-size: 0.75rem;
		font-weight: bold;
		color: white;
		background: var(--team-row-color);
		box-shadow:
			0 0 0 2px var(--bg-secondary),
			-6px 0 0 0 var(--bg-secondary);
	}

	.team-col-bg {
		background: var(--team-col-color);
	}

	.team-row-bg {
		background: var(--team-row-color);
	}

	.rounded-tl {
		border-top-left-radius: 6px;
	}
	.rounded-tr {
		border-top-right-radius: 6px;
	}
	.rounded-bl {
		border-bottom-left-radius: 6px;
	}

	.square-wrapper {
		transition:
			opacity 200ms ease,
			transform 200ms ease;
	}

	.square-wrapper.highlighted {
		/* One colour for the glow and, without motion, the outline that replaces it. */
		--highlight: rgb(var(--rgb-teal) / 0.6);
		z-index: 5;
		transform: scale(1.05);
		filter: drop-shadow(0 0 8px var(--highlight));
	}

	.square-wrapper.dimmed {
		opacity: 0.35;
	}

	.grid-control-center {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		padding: 0.75rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 12px;
		border: 1px solid var(--border-color);
	}

	.control-top-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.legend-items {
		display: flex;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.legend-item {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--text-secondary);
	}

	.legend-swatch {
		width: 1rem;
		height: 1rem;
		border-radius: 4px;
		border: 1px solid var(--border-color);
	}

	.legend-available {
		background: var(--square-empty-fill);
		border-color: var(--square-empty-border);
	}

	.legend-mine {
		outline-style: solid;
		outline-width: 2px;
		outline-offset: -1px;
	}

	.legend-winner {
		background: var(--square-winner-fill);
		border-color: var(--square-winner-border);
		outline: 2px solid var(--square-winner-ring);
		outline-offset: -1px;
		box-shadow: 0 0 8px rgb(var(--rgb-success) / 0.4);
	}

	.legend-leading {
		border-color: var(--square-leading-border);
		outline: 2px solid var(--square-leading-ring);
		outline-offset: -1px;
	}

	.selection-indicator {
		position: fixed;
		bottom: calc(max(1rem, env(safe-area-inset-bottom, 0px)) + 1rem);
		left: 50%;
		transform: translateX(-50%);
		padding: 0.5rem 1rem;
		background: rgba(26, 26, 36, 0.9);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 20px;
		box-shadow: 0 4px 24px var(--shadow-color);
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		z-index: 100;
	}

	@media (max-width: 639px) {
		.grid-control-center {
			margin-top: 0.5rem;
		}
	}

	@media (min-width: 640px) {
		.col-header,
		.row-header {
			font-size: 0.875rem;
		}

		.team-label-row {
			width: 56px;
		}
	}

	@media (min-width: 768px) {
		.team-label-row {
			width: 64px;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.square-wrapper {
			transition: none;
		}

		.square-wrapper.highlighted {
			filter: none;
			outline: 2px solid var(--highlight);
		}
	}
</style>
