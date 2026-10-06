<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Square from './Square.svelte';
	import MobilePlayerFilter from './MobilePlayerFilter.svelte';
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
		selectedPlayerFilter,
		leadingSquare,
	} from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { userName, normalizePlayerName } from '$lib/stores/user';
	import { formatPrice } from '$lib/utils/format';
	import { getPlayerColor } from '$lib/utils/colors';
	import { APP_CONFIG } from '$lib/config';
	import { GRID_SIZE } from '$lib/constants';
	import { DragSelect } from '$lib/utils/dragSelect.svelte';
	import {
		buildSquareMap,
		buildWinnerMap,
		cellKey,
		getEffectiveCellSize,
		getFitCellSize,
		getHeaderHeight,
		shouldShowZoomControl,
		type ZoomState,
	} from '$lib/utils/gridLayout';
	import type { Square as SquareType, Winner } from '$lib/types';

	// DOM refs
	let scrollContainer: HTMLDivElement;
	let gridWrapper: HTMLDivElement;

	// Sizing state
	let containerWidth = $state(0);
	let zoomState = $state<ZoomState>('fit');

	// Pointer drag-select (see $lib/utils/dragSelect.svelte.ts)
	const drag = new DragSelect({
		canInteract: () => !!$userName && $party?.status === 'filling',
		canSelectCell,
		onCellClick: handleSquareClick,
		// Non-blocking optimistic batch claim
		onBatch: (cells) => claimSquaresBatchOptimistic(cells),
	});

	// Lifecycle guards
	let isMounted = false;
	let resizeObserver: ResizeObserver | null = null;

	const fitCellSize = $derived(getFitCellSize(containerWidth));
	const effectiveCellSize = $derived(getEffectiveCellSize(zoomState, fitCellSize));
	const showZoomControl = $derived(shouldShowZoomControl(fitCellSize));
	const headerHeight = $derived(getHeaderHeight(effectiveCellSize));

	// Derived lookup maps for O(1) access
	const squareMap = $derived(buildSquareMap($squares));
	const winnerMap = $derived(buildWinnerMap($winners, !!$numbers));

	function getSquare(row: number, col: number): SquareType | undefined {
		return squareMap.get(cellKey(row, col));
	}

	function getWinners(row: number, col: number): Winner[] {
		return winnerMap.get(cellKey(row, col)) || [];
	}

	function canSelectCell(row: number, col: number): boolean {
		if (!$userName || $party?.status !== 'filling') return false;
		const square = getSquare(row, col);
		return square !== undefined && square.player_name === null;
	}

	// Check if a square should be highlighted based on player filter
	function isSquareHighlighted(square: SquareType): boolean {
		if (!$selectedPlayerFilter) return false;
		return square.player_name_lower === $selectedPlayerFilter;
	}

	// Check if a square should be dimmed
	function isSquareDimmed(square: SquareType): boolean {
		if (!$selectedPlayerFilter) return false;
		return square.player_name_lower !== $selectedPlayerFilter;
	}

	function handleSquareClick(row: number, col: number) {
		if (!$userName || $party?.status !== 'filling') return;

		const square = getSquare(row, col);
		if (!square) return;

		if (square.player_name_lower === normalizePlayerName($userName)) {
			// Non-blocking optimistic unclaim
			unclaimSquareOptimistic(row, col);
		} else if (!square.player_name) {
			// Non-blocking optimistic claim
			claimSquareOptimistic(row, col);
		}
	}

	function handleSquareKeyboardClick(row: number, col: number, e: MouseEvent) {
		if (e.detail !== 0) return;
		handleSquareClick(row, col);
	}

	// Check if a square has a pending operation
	function isSquarePending(row: number, col: number): boolean {
		return $pendingOperations.has(cellKey(row, col));
	}

	onMount(() => {
		isMounted = true;

		if (browser && gridWrapper) {
			containerWidth = gridWrapper.clientWidth;

			resizeObserver = new ResizeObserver((entries) => {
				if (!isMounted) return;
				for (const entry of entries) {
					containerWidth = entry.contentRect.width;
				}
			});
			resizeObserver.observe(gridWrapper);
		}
	});

	onDestroy(() => {
		isMounted = false;

		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	// Current user's player color for the legend swatch
	const myColor = $derived($userName ? getPlayerColor(normalizePlayerName($userName)) : null);

	const rows = Array.from({ length: GRID_SIZE }, (_, i) => i);
	const cols = Array.from({ length: GRID_SIZE }, (_, i) => i);

	// Logo visibility — show logo when party team name matches the configured default team name
	const showColLogo = $derived(
		$theme.colName?.toLowerCase().trim() === APP_CONFIG.defaultTeams.col.name.toLowerCase().trim()
	);
	const showRowLogo = $derived(
		$theme.rowName?.toLowerCase().trim() === APP_CONFIG.defaultTeams.row.name.toLowerCase().trim()
	);
</script>

<svelte:window
	onpointerup={() => drag.globalPointerUp()}
	onpointercancel={() => drag.globalPointerCancel()}
/>

<div class="space-y-4">
	<!-- Player Stats Bar -->
	{#if $userName}
		<div class="stats-bar">
			<div class="flex items-center gap-2">
				<span class="text-sm" style="color: var(--text-secondary)">Your squares:</span>
				<span class="font-bold text-lg">{$mySquareCount}</span>
			</div>
			{#if $party && $party.square_price > 0}
				<div class="flex items-center gap-2">
					<span class="text-sm" style="color: var(--text-secondary)">You owe:</span>
					<span class="font-bold text-lg" style="color: var(--color-accent)"
						>{formatPrice($amountOwed)}</span
					>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Grid Wrapper -->
	<div class="grid-wrapper" bind:this={gridWrapper}>
		<!-- Column Team Label -->
		<div class="team-label-col">
			{#if showColLogo}
				<img
					src={APP_CONFIG.defaultTeams.col.logoUrl}
					alt=""
					aria-hidden="true"
					class="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain drop-shadow-lg"
					onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
				/>
			{/if}
			<span
				class="team-name font-bold text-xl sm:text-2xl md:text-3xl"
				style="color: {$theme.colColor}"
			>
				{$theme.colName}
			</span>
		</div>

		<div class="grid-with-row-label">
			<!-- Row Team Label -->
			<div class="team-label-row">
				<span
					class="team-name font-bold text-base sm:text-lg md:text-xl writing-vertical flex items-center"
					style="color: {$theme.rowColor}"
				>
					{$theme.rowName}
				</span>
				{#if showRowLogo}
					<img
						src={APP_CONFIG.defaultTeams.row.logoUrl}
						alt=""
						aria-hidden="true"
						class="w-8 h-8 sm:w-10 sm:h-10 md:w-12 md:h-12 object-contain drop-shadow-lg"
						onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
					/>
				{/if}
			</div>

			<!-- Scrollable Grid Container -->
			<div
				class="scroll-container"
				class:fit-mode={zoomState === 'fit'}
				bind:this={scrollContainer}
				style="--cell-size: {effectiveCellSize}px; --header-height: {headerHeight}px;"
			>
				<div
					class="grid-11x11"
					role="grid"
					aria-label="Football squares grid, 10 by 10."
					aria-rowcount={GRID_SIZE + 1}
					aria-colcount={GRID_SIZE + 1}
				>
					<div class="corner-cell" role="presentation"></div>

					{#each cols as col (col)}
						<div
							class="col-header team-col-bg {col === 0 ? 'rounded-tl' : ''} {col === 9
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
							class="row-header team-row-bg {row === 0 ? 'rounded-tl' : ''} {row === 9
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
										isLocked={$party?.status !== 'filling'}
										isSelected={drag.selectedCells.has(cellKey(row, col))}
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

	<!-- Expanded Legend / Control Center -->
	<div class="grid-control-center">
		<!-- Top Row: Legend + Zoom Toggle -->
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
							style="background: {myColor.bg}; border-color: {myColor.text.replace(
								/0\.9[58]/g,
								'0.5'
							)}; outline-color: {myColor.text.replace(/0\.9[58]/g, '0.7')};"
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

			<!-- Zoom Toggle (shown when horizontal scroll would occur) -->
			{#if showZoomControl}
				<ZoomToggle
					{zoomState}
					ontoggle={() => (zoomState = zoomState === 'fit' ? 'zoomed' : 'fit')}
				/>
			{/if}
		</div>

		<!-- Players Section (mobile only - desktop uses sidebar's PlayerLegend) -->
		<div class="lg:hidden">
			<MobilePlayerFilter />
		</div>
	</div>

	<!-- Selection indicator during drag -->
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

	.grid-11x11 {
		display: grid;
		grid-template-columns: repeat(11, var(--cell-size));
		grid-template-rows: var(--header-height) repeat(10, var(--cell-size));
		gap: 2px;
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
		background: var(--team-row-color, #69be28);
		box-shadow:
			0 0 0 2px var(--bg-secondary),
			-6px 0 0 0 var(--bg-secondary);
	}

	.team-col-bg {
		background: var(--team-col-color, #c60c30);
	}

	.team-row-bg {
		background: var(--team-row-color, #69be28);
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

	/* Square wrapper for highlight/dim effects */
	.square-wrapper {
		transition:
			opacity 200ms ease,
			transform 200ms ease;
	}

	.square-wrapper.highlighted {
		z-index: 5;
		transform: scale(1.05);
		filter: drop-shadow(0 0 8px var(--player-text, rgba(100, 210, 200, 0.6)));
	}

	.square-wrapper.dimmed {
		opacity: 0.35;
	}

	/* Control Center (Expanded Legend) */
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
		background: rgba(255, 255, 255, 0.06);
		border-color: rgba(255, 255, 255, 0.08);
	}

	.legend-mine {
		outline-style: solid;
		outline-width: 2px;
		outline-offset: -1px;
	}

	.legend-winner {
		background: linear-gradient(135deg, rgba(100, 200, 130, 0.35), rgba(100, 210, 200, 0.35));
		border-color: rgba(100, 200, 130, 0.6);
		outline: 2px solid rgba(100, 200, 130, 0.8);
		outline-offset: -1px;
		box-shadow: 0 0 8px rgba(100, 200, 130, 0.4);
	}

	.legend-leading {
		border-color: rgba(255, 255, 255, 0.7);
		outline: 2px solid rgba(255, 255, 255, 0.9);
		outline-offset: -1px;
	}

	/* Selection indicator */
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
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		z-index: 100;
	}

	/* Mobile: Control center spacing */
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

	/* Reduced motion support */
	@media (prefers-reduced-motion: reduce) {
		.square-wrapper {
			transition: none;
		}

		.square-wrapper.highlighted {
			filter: none;
			outline: 2px solid var(--player-text);
		}
	}
</style>
