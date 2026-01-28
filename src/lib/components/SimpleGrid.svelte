<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Square from './Square.svelte';
	import { squares, numbers, party, winners, claimSquare, claimSquaresBatch, unclaimSquare, mySquareCount, amountOwed } from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { userName } from '$lib/stores/user';
	import type { Square as SquareType, Winner } from '$lib/types';

	// Constants
	const MIN_CELL_SIZE_DESKTOP = 44; // Apple HIG minimum touch target (desktop only)
	const MIN_CELL_SIZE_MOBILE = 28; // Allow smaller cells on mobile to fit screen
	const ZOOMED_CELL_SIZE = 64;
	const ROW_HEADER_WIDTH = 28; // Slightly smaller header for mobile fit
	const GAP_SIZE = 2;
	const NUM_COLS = 10;
	const NUM_GAPS = NUM_COLS - 1;
	const TEAM_LABEL_WIDTH = 36; // Width of vertical team label (32px) + gap (4px)
	const SCROLL_CONTAINER_PADDING = 8; // 0.25rem * 2 sides

	// DOM refs
	let scrollContainer: HTMLDivElement;
	let gridWrapper: HTMLDivElement;

	// Sizing state
	let containerWidth = $state(0);
	let isTouchDevice = $state(false);
	let zoomState = $state<'fit' | 'zoomed'>('fit');

	// Selection state
	let isDragging = $state(false);
	let selectedCells = $state<Set<string>>(new Set());
	let dragStartCell = $state<{ row: number; col: number } | null>(null);
	let isProcessing = $state(false);

	// Track pointer start for mobile tap detection
	let pointerStartCell: { row: number; col: number } | null = null;

	// Lifecycle guards
	let isMounted = false;
	let resizeObserver: ResizeObserver | null = null;

	// Calculate fit-to-width cell size
	function calculateFitCellSize(): number {
		if (!containerWidth) return MIN_CELL_SIZE_MOBILE;
		const gapTotal = NUM_GAPS * GAP_SIZE;
		// Account for: row header, gaps between cells, scroll container padding
		const availableWidth = containerWidth - TEAM_LABEL_WIDTH - ROW_HEADER_WIDTH - gapTotal - SCROLL_CONTAINER_PADDING;
		return Math.floor(availableWidth / NUM_COLS);
	}

	// Minimum cell size depends on device
	let minCellSize = $derived(isTouchDevice ? MIN_CELL_SIZE_MOBILE : MIN_CELL_SIZE_DESKTOP);

	// Effective cell size based on zoom state
	let effectiveCellSize = $derived(
		zoomState === 'zoomed'
			? ZOOMED_CELL_SIZE
			: Math.max(minCellSize, calculateFitCellSize())
	);

	// Header height scales with cell size
	let headerHeight = $derived(Math.max(Math.floor(effectiveCellSize * 0.7), 24));

	// Derived lookup maps for O(1) access
	let squareMap = $derived.by(() => {
		const map = new Map<string, SquareType>();
		for (const s of $squares) {
			map.set(`${s.row_num}-${s.col_num}`, s);
		}
		return map;
	});

	let winnerMap = $derived.by(() => {
		if (!$numbers) return new Map<string, Winner>();
		const map = new Map<string, Winner>();
		for (const w of $winners) {
			const row = $numbers.row_numbers.indexOf(w.winning_row);
			const col = $numbers.col_numbers.indexOf(w.winning_col);
			if (row !== -1 && col !== -1) {
				map.set(`${row}-${col}`, w);
			}
		}
		return map;
	});

	function getSquare(row: number, col: number): SquareType | undefined {
		return squareMap.get(`${row}-${col}`);
	}

	function getWinner(row: number, col: number): Winner | null {
		return winnerMap.get(`${row}-${col}`) || null;
	}

	function cellKey(row: number, col: number): string {
		return `${row}-${col}`;
	}

	function canSelectCell(row: number, col: number): boolean {
		if (!$userName || $party?.status !== 'filling') return false;
		const square = getSquare(row, col);
		return square !== undefined && square.player_name === null;
	}

	// Toggle zoom
	function toggleZoom() {
		zoomState = zoomState === 'fit' ? 'zoomed' : 'fit';
	}

	// Pointer handlers
	function handlePointerDown(row: number, col: number, e: PointerEvent) {
		if (!$userName || $party?.status !== 'filling') return;
		if (e.button !== 0) return;

		pointerStartCell = { row, col };

		// Desktop - immediate drag selection
		if (!isTouchDevice && canSelectCell(row, col)) {
			isDragging = true;
			dragStartCell = { row, col };
			selectedCells = new Set([cellKey(row, col)]);
		}
		// Mobile - just track start cell, claim on pointer up
	}

	function handlePointerMove(row: number, col: number) {
		// Desktop only - extend selection during drag
		if (!isTouchDevice && isDragging && dragStartCell) {
			handleDragExtend(row, col);
		}
	}

	function handleDragExtend(row: number, col: number) {
		if (!dragStartCell) return;

		const minRow = Math.min(dragStartCell.row, row);
		const maxRow = Math.max(dragStartCell.row, row);
		const minCol = Math.min(dragStartCell.col, col);
		const maxCol = Math.max(dragStartCell.col, col);

		const newSelection = new Set<string>();
		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				if (canSelectCell(r, c)) {
					newSelection.add(cellKey(r, c));
				}
			}
		}
		selectedCells = newSelection;
	}

	function handlePointerUp(row: number, col: number) {
		if (isTouchDevice) {
			// Mobile - tap to claim single cell
			if (pointerStartCell && pointerStartCell.row === row && pointerStartCell.col === col) {
				handleSquareClick(row, col);
			}
		} else {
			// Desktop - end drag selection
			if (isDragging) {
				handleDragEnd();
			}
		}
		pointerStartCell = null;
	}

	async function handleDragEnd() {
		if (!isDragging) return;

		isDragging = false;
		dragStartCell = null;

		if (selectedCells.size > 0 && !isProcessing) {
			isProcessing = true;
			const cells = Array.from(selectedCells).map((key) => {
				const [row, col] = key.split('-').map(Number);
				return { row, col };
			});
			await claimSquaresBatch(cells);
			selectedCells = new Set();
			isProcessing = false;
		}
	}

	async function handleSquareClick(row: number, col: number) {
		if (!$userName || $party?.status !== 'filling') return;

		const square = getSquare(row, col);
		if (!square) return;

		if (square.player_name_lower === $userName.toLowerCase()) {
			await unclaimSquare(row, col);
		} else if (!square.player_name) {
			await claimSquare(row, col);
		}
	}

	function handleGlobalPointerUp() {
		if (isDragging) {
			handleDragEnd();
		}
		pointerStartCell = null;
	}

	function handleGlobalPointerCancel() {
		isDragging = false;
		dragStartCell = null;
		selectedCells = new Set();
		pointerStartCell = null;
	}

	onMount(() => {
		isMounted = true;

		if (browser) {
			isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

			// Measure container width
			if (gridWrapper) {
				containerWidth = gridWrapper.clientWidth;

				resizeObserver = new ResizeObserver((entries) => {
					if (!isMounted) return;
					for (const entry of entries) {
						containerWidth = entry.contentRect.width;
					}
				});
				resizeObserver.observe(gridWrapper);
			}
		}
	});

	onDestroy(() => {
		isMounted = false;

		if (resizeObserver) {
			resizeObserver.disconnect();
		}
	});

	const rows = Array.from({ length: 10 }, (_, i) => i);
	const cols = Array.from({ length: 10 }, (_, i) => i);
</script>

<svelte:window
	onpointerup={handleGlobalPointerUp}
	onpointercancel={handleGlobalPointerCancel}
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
					<span class="font-bold text-lg" style="color: var(--color-accent)">${$amountOwed.toFixed(2)}</span>
				</div>
			{/if}
		</div>
	{/if}

	<!-- Grid Wrapper -->
	<div class="grid-wrapper" bind:this={gridWrapper}>
		<!-- Column Team Label (horizontal, above grid) -->
		<div class="team-label-col">
			<img
				src="/logos/patriots.svg"
				alt={$theme.colName}
				class="w-6 h-6 sm:w-7 sm:h-7 object-contain"
				onerror={(e) => (e.currentTarget as HTMLElement).style.display = 'none'}
			/>
			<span class="font-bold text-base sm:text-lg" style="color: {$theme.colColor}">
				{$theme.colName}
			</span>
		</div>

		<div class="grid-with-row-label">
			<!-- Row Team Label (vertical, left of grid) -->
			<div class="team-label-row">
				<img
					src="/logos/seahawks.svg"
					alt={$theme.rowName}
					class="w-6 h-6 sm:w-7 sm:h-7 object-contain"
					onerror={(e) => (e.currentTarget as HTMLElement).style.display = 'none'}
				/>
				<span
					class="font-bold text-sm sm:text-base writing-vertical flex-1 flex items-center"
					style="color: {$theme.rowColor}"
				>
					{$theme.rowName}
				</span>
			</div>

			<!-- Scrollable Grid Container -->
			<div
				class="scroll-container"
				bind:this={scrollContainer}
				style="--cell-size: {effectiveCellSize}px; --header-height: {headerHeight}px; --row-header-width: {ROW_HEADER_WIDTH}px;"
			>
				<div class="grid-11x11">
					<!-- Corner cell (empty) -->
					<div class="corner-cell"></div>

					<!-- Column headers (score digits) -->
					{#each cols as col}
						<div class="col-header team-col-bg {col === 0 ? 'rounded-tl' : ''} {col === 9 ? 'rounded-tr' : ''}">
							{$numbers ? $numbers.col_numbers[col] : '?'}
						</div>
					{/each}

					<!-- Grid rows (row header + 10 squares per row) -->
					{#each rows as row}
						<!-- Row header (sticky) -->
						<div class="row-header team-row-bg {row === 0 ? 'rounded-tl' : ''} {row === 9 ? 'rounded-bl' : ''}">
							{$numbers ? $numbers.row_numbers[row] : '?'}
						</div>

						<!-- Squares for this row -->
						{#each cols as col}
							{@const square = getSquare(row, col)}
							{#if square}
								<Square
									{square}
									size={effectiveCellSize}
									rowNumber={$numbers?.row_numbers[row]}
									colNumber={$numbers?.col_numbers[col]}
									isLocked={$party?.status !== 'filling'}
									isSelected={selectedCells.has(cellKey(row, col))}
									winner={getWinner(row, col)}
									onpointerdown={(e) => handlePointerDown(row, col, e)}
									onpointerenter={() => handlePointerMove(row, col)}
									onpointerup={() => handlePointerUp(row, col)}
								/>
							{/if}
						{/each}
					{/each}
				</div>
			</div>
		</div>
	</div>

	<!-- Zoom FAB (mobile only) -->
	{#if isTouchDevice}
		<button
			class="zoom-fab"
			onclick={toggleZoom}
			aria-label={zoomState === 'fit' ? 'Zoom in' : 'Fit to screen'}
		>
			{#if zoomState === 'fit'}
				<!-- Zoom in icon -->
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<circle cx="11" cy="11" r="8"></circle>
					<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
					<line x1="11" y1="8" x2="11" y2="14"></line>
					<line x1="8" y1="11" x2="14" y2="11"></line>
				</svg>
			{:else}
				<!-- Fit to screen icon -->
				<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M8 3H5a2 2 0 0 0-2 2v3"></path>
					<path d="M21 8V5a2 2 0 0 0-2-2h-3"></path>
					<path d="M3 16v3a2 2 0 0 0 2 2h3"></path>
					<path d="M16 21h3a2 2 0 0 0 2-2v-3"></path>
				</svg>
			{/if}
		</button>
	{/if}

	<!-- Grid Legend -->
	<div class="grid-legend">
		<div class="legend-item">
			<div class="legend-swatch legend-available"></div>
			<span>Available</span>
		</div>
		{#if $userName}
			<div class="legend-item">
				<div class="legend-swatch legend-mine"></div>
				<span>Yours</span>
			</div>
		{/if}
		<div class="legend-item">
			<div class="legend-swatch legend-winner"></div>
			<span>Winner</span>
		</div>
	</div>

	<!-- Selection indicator during drag -->
	{#if isDragging && selectedCells.size > 0}
		<div class="selection-indicator">
			{isProcessing ? 'Claiming...' : `${selectedCells.size} squares`}
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
		gap: 0.5rem;
		padding: 0.5rem 0;
	}

	.grid-with-row-label {
		display: flex;
		gap: 0.25rem; /* Minimal gap for mobile fit */
	}

	.team-label-row {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.25rem;
		padding: 0.25rem 0;
		flex-shrink: 0;
		width: 32px; /* Compact width for mobile */
	}

	/* Scrollable container - horizontal scroll only */
	.scroll-container {
		flex: 1;
		overflow-x: auto;
		overflow-y: visible;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior-x: contain;
		border-radius: 12px;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		padding: 0.25rem;
	}

	/* 11x11 CSS Grid layout */
	.grid-11x11 {
		display: grid;
		grid-template-columns: var(--row-header-width) repeat(10, var(--cell-size));
		grid-template-rows: var(--header-height) repeat(10, var(--cell-size));
		gap: 2px;
		width: fit-content;
	}

	/* Corner cell (top-left) */
	.corner-cell {
		position: sticky;
		left: 0;
		z-index: 20;
		background: var(--bg-secondary);
		width: var(--row-header-width);
		height: var(--header-height);
	}

	/* Column headers (score digits) */
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

	@media (min-width: 640px) {
		.col-header {
			font-size: 0.875rem;
		}
	}

	/* Row headers (sticky during horizontal scroll) */
	.row-header {
		position: sticky;
		left: 0;
		z-index: 10;
		display: flex;
		align-items: center;
		justify-content: center;
		width: var(--row-header-width);
		height: var(--cell-size);
		font-size: 0.75rem;
		font-weight: bold;
		color: white;
		background: var(--team-row-color, #69BE28);
	}

	@media (min-width: 640px) {
		.row-header {
			font-size: 0.875rem;
		}
	}

	/* Team color backgrounds */
	.team-col-bg {
		background: var(--team-col-color, #C60C30);
	}

	.team-row-bg {
		background: var(--team-row-color, #69BE28);
	}

	/* Border radius helpers */
	.rounded-tl {
		border-top-left-radius: 6px;
	}
	.rounded-tr {
		border-top-right-radius: 6px;
	}
	.rounded-bl {
		border-bottom-left-radius: 6px;
	}

	/* Zoom FAB */
	.zoom-fab {
		position: fixed;
		bottom: calc(max(1rem, env(safe-area-inset-bottom, 0px)) + 1rem);
		right: max(1rem, env(safe-area-inset-right, 0px));
		width: 56px;
		height: 56px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(26, 26, 36, 0.9);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 16px;
		color: var(--text-primary);
		cursor: pointer;
		z-index: 100;
		box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
		transition: all 200ms ease;
		touch-action: manipulation;
	}

	.zoom-fab:hover {
		background: rgba(26, 26, 36, 0.95);
		border-color: rgba(100, 210, 200, 0.3);
	}

	.zoom-fab:active {
		transform: scale(0.95);
	}

	/* Grid Legend */
	.grid-legend {
		display: flex;
		justify-content: center;
		gap: 1rem;
		padding: 0.75rem;
		margin-top: 0.75rem;
		background: rgba(255, 255, 255, 0.03);
		border-radius: 10px;
		border: 1px solid var(--border-color);
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
		background: linear-gradient(135deg, rgba(244, 143, 177, 0.3), rgba(180, 130, 200, 0.3));
		border-color: rgba(244, 143, 177, 0.5);
		outline: 2px solid rgba(244, 143, 177, 0.7);
		outline-offset: -1px;
	}

	.legend-winner {
		background: linear-gradient(135deg, rgba(100, 200, 130, 0.35), rgba(100, 210, 200, 0.35));
		border-color: rgba(100, 200, 130, 0.6);
		outline: 2px solid rgba(100, 200, 130, 0.8);
		outline-offset: -1px;
		box-shadow: 0 0 8px rgba(100, 200, 130, 0.4);
	}

	/* Selection indicator */
	.selection-indicator {
		position: fixed;
		bottom: calc(max(1rem, env(safe-area-inset-bottom, 0px)) + 80px);
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
</style>
