<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { browser } from '$app/environment';
	import Square from './Square.svelte';
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
		playerSummary,
		availableCount,
		selectedPlayerFilter,
	} from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { userName, normalizePlayerName } from '$lib/stores/user';
	import { formatPrice } from '$lib/utils/format';
	import type { Square as SquareType, Winner } from '$lib/types';

	// Constants
	const MIN_CELL_SIZE_MOBILE = 28;
	const ZOOMED_CELL_SIZE = 64;
	const GAP_SIZE = 2;
	const NUM_COLS = 10;
	const TEAM_LABEL_WIDTH = 36;
	const SCROLL_CONTAINER_PADDING = 8;

	// Player colors (same as Square.svelte)
	const playerColors = [
		{ bg: 'rgba(100, 180, 255, 0.22)', text: 'rgba(120, 190, 255, 0.95)' },
		{ bg: 'rgba(255, 110, 110, 0.22)', text: 'rgba(255, 130, 130, 0.95)' },
		{ bg: 'rgba(100, 230, 100, 0.22)', text: 'rgba(120, 240, 120, 0.95)' },
		{ bg: 'rgba(255, 230, 100, 0.22)', text: 'rgba(255, 235, 130, 0.98)' },
		{ bg: 'rgba(180, 100, 255, 0.22)', text: 'rgba(190, 120, 255, 0.95)' },
		{ bg: 'rgba(255, 150, 80, 0.22)', text: 'rgba(255, 170, 110, 0.98)' },
		{ bg: 'rgba(100, 230, 230, 0.22)', text: 'rgba(120, 240, 240, 0.95)' },
		{ bg: 'rgba(255, 100, 170, 0.22)', text: 'rgba(255, 130, 185, 0.95)' },
		{ bg: 'rgba(190, 255, 100, 0.22)', text: 'rgba(200, 255, 130, 0.98)' },
		{ bg: 'rgba(255, 130, 220, 0.22)', text: 'rgba(255, 150, 230, 0.95)' },
		{ bg: 'rgba(100, 255, 190, 0.22)', text: 'rgba(120, 255, 200, 0.95)' },
		{ bg: 'rgba(230, 190, 150, 0.22)', text: 'rgba(245, 210, 175, 0.98)' },
		{ bg: 'rgba(130, 200, 200, 0.22)', text: 'rgba(150, 220, 220, 0.95)' },
		{ bg: 'rgba(200, 160, 255, 0.22)', text: 'rgba(210, 175, 255, 0.95)' },
		{ bg: 'rgba(255, 200, 150, 0.22)', text: 'rgba(255, 215, 175, 0.98)' },
	];

	function getPlayerColor(name: string): { bg: string; text: string } {
		let hash = 0;
		for (let i = 0; i < name.length; i++) {
			hash = name.charCodeAt(i) + ((hash << 5) - hash);
		}
		return playerColors[Math.abs(hash) % playerColors.length];
	}

	// DOM refs
	let scrollContainer: HTMLDivElement;
	let gridWrapper: HTMLDivElement;

	// Sizing state
	let containerWidth = $state(0);
	let zoomState = $state<'fit' | 'zoomed'>('fit');

	// Selection state
	let isDragging = $state(false);
	const selectedCells = new SvelteSet<string>();
	let dragStartCell = $state<{ row: number; col: number } | null>(null);
	let isProcessing = $state(false);

	// Player filter state (using shared store)
	let isPlayersExpanded = $state(false);
	let hasInteractedWithPlayers = $state(false);

	// Track pointer start for mobile tap detection
	let pointerStartCell: { row: number; col: number } | null = null;
	let isPointerTouch = false; // Track if current interaction is touch-based

	// Lifecycle guards
	let isMounted = false;
	let resizeObserver: ResizeObserver | null = null;

	// Calculate fit-to-width cell size
	function calculateFitCellSize(): number {
		if (!containerWidth) return MIN_CELL_SIZE_MOBILE;
		const totalColumns = NUM_COLS + 1; // 10 data + 1 row header
		const totalGaps = totalColumns - 1;
		const gapTotal = totalGaps * GAP_SIZE;
		const availableWidth = containerWidth - TEAM_LABEL_WIDTH - gapTotal - SCROLL_CONTAINER_PADDING;
		return Math.floor(availableWidth / totalColumns);
	}

	// Calculate fit cell size
	const fitCellSize = $derived(Math.max(MIN_CELL_SIZE_MOBILE, calculateFitCellSize()));

	// Effective cell size based on zoom state
	const effectiveCellSize = $derived(zoomState === 'zoomed' ? ZOOMED_CELL_SIZE : fitCellSize);

	// Show zoom control when zooming would cause horizontal scroll
	const showZoomControl = $derived(fitCellSize < ZOOMED_CELL_SIZE);

	// Header height scales with cell size
	const headerHeight = $derived(Math.max(Math.floor(effectiveCellSize * 0.7), 24));

	// Auto-expand players list if few players
	$effect(() => {
		if ($playerSummary.length > 0 && $playerSummary.length <= 4) {
			isPlayersExpanded = true;
		}
	});

	// Derived lookup maps for O(1) access
	const squareMap = $derived.by(() => {
		const map = new SvelteMap<string, SquareType>();
		for (const s of $squares) {
			map.set(`${s.row_num}-${s.col_num}`, s);
		}
		return map;
	});

	const winnerMap = $derived.by(() => {
		if (!$numbers) return new SvelteMap<string, Winner[]>();
		const map = new SvelteMap<string, Winner[]>();
		for (const w of $winners) {
			// winning_row and winning_col are grid positions (0-9), not header numbers
			const key = `${w.winning_row}-${w.winning_col}`;
			const existing = map.get(key) || [];
			existing.push(w);
			map.set(key, existing);
		}
		return map;
	});

	function getSquare(row: number, col: number): SquareType | undefined {
		return squareMap.get(`${row}-${col}`);
	}

	function getWinners(row: number, col: number): Winner[] {
		return winnerMap.get(`${row}-${col}`) || [];
	}

	function cellKey(row: number, col: number): string {
		return `${row}-${col}`;
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

	// Toggle player filter
	function togglePlayerFilter(normalizedName: string) {
		hasInteractedWithPlayers = true;
		selectedPlayerFilter.update((current) => (current === normalizedName ? null : normalizedName));
	}

	// Handle players section toggle
	function handlePlayersToggle() {
		hasInteractedWithPlayers = true;
		isPlayersExpanded = !isPlayersExpanded;
	}

	// Pointer handlers
	function handlePointerDown(row: number, col: number, e: PointerEvent) {
		if (!$userName || $party?.status !== 'filling') return;
		if (e.button !== 0) return;

		pointerStartCell = { row, col };
		isPointerTouch = e.pointerType === 'touch';

		// Mouse/pen - immediate drag selection (not touch)
		if (!isPointerTouch && canSelectCell(row, col)) {
			isDragging = true;
			dragStartCell = { row, col };
			selectedCells.clear();
			selectedCells.add(cellKey(row, col));
		}
	}

	function handlePointerMove(row: number, col: number) {
		if (!isPointerTouch && isDragging && dragStartCell) {
			handleDragExtend(row, col);
		}
	}

	function handleDragExtend(row: number, col: number) {
		if (!dragStartCell) return;

		const minRow = Math.min(dragStartCell.row, row);
		const maxRow = Math.max(dragStartCell.row, row);
		const minCol = Math.min(dragStartCell.col, col);
		const maxCol = Math.max(dragStartCell.col, col);

		selectedCells.clear();
		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				if (canSelectCell(r, c)) {
					selectedCells.add(cellKey(r, c));
				}
			}
		}
	}

	function handlePointerUp(row: number, col: number) {
		if (isPointerTouch) {
			// Touch - single tap to claim/unclaim
			if (pointerStartCell && pointerStartCell.row === row && pointerStartCell.col === col) {
				handleSquareClick(row, col);
			}
		} else {
			// Mouse/pen - end drag selection
			if (isDragging) {
				handleDragEnd();
			}
		}
		pointerStartCell = null;
	}

	function handleDragEnd() {
		if (!isDragging) return;

		isDragging = false;
		dragStartCell = null;

		if (selectedCells.size > 0 && !isProcessing) {
			isProcessing = true;
			const cells = Array.from(selectedCells).map((key) => {
				const [row, col] = key.split('-').map(Number);
				return { row, col };
			});
			// Non-blocking optimistic batch claim
			claimSquaresBatchOptimistic(cells);
			selectedCells.clear();
			isProcessing = false;
		}
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

	// Check if a square has a pending operation
	function isSquarePending(row: number, col: number): boolean {
		return $pendingOperations.has(cellKey(row, col));
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
		selectedCells.clear();
		pointerStartCell = null;
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
	const myColor = $derived($userName ? getPlayerColor($userName) : null);

	const rows = Array.from({ length: 10 }, (_, i) => i);
	const cols = Array.from({ length: 10 }, (_, i) => i);
</script>

<svelte:window onpointerup={handleGlobalPointerUp} onpointercancel={handleGlobalPointerCancel} />

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
			<img
				src="/logos/patriots.png"
				alt={$theme.colName}
				class="w-6 h-6 sm:w-7 sm:h-7 object-contain"
				onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
			/>
			<span class="font-bold text-base sm:text-lg" style="color: {$theme.colColor}">
				{$theme.colName}
			</span>
		</div>

		<div class="grid-with-row-label">
			<!-- Row Team Label -->
			<div class="team-label-row">
				<span
					class="font-bold text-sm sm:text-base writing-vertical flex items-center"
					style="color: {$theme.rowColor}"
				>
					{$theme.rowName}
				</span>
				<img
					src="/logos/seahawks.png"
					alt={$theme.rowName}
					class="row-logo w-6 h-6 sm:w-7 sm:h-7 object-contain"
					onerror={(e) => ((e.currentTarget as HTMLElement).style.display = 'none')}
				/>
			</div>

			<!-- Scrollable Grid Container -->
			<div
				class="scroll-container"
				class:fit-mode={zoomState === 'fit'}
				bind:this={scrollContainer}
				style="--cell-size: {effectiveCellSize}px; --header-height: {headerHeight}px;"
			>
				<div class="grid-11x11">
					<div class="corner-cell"></div>

					{#each cols as col (col)}
						<div
							class="col-header team-col-bg {col === 0 ? 'rounded-tl' : ''} {col === 9
								? 'rounded-tr'
								: ''}"
						>
							{$numbers ? $numbers.col_numbers[col] : '?'}
						</div>
					{/each}

					{#each rows as row (row)}
						<div
							class="row-header team-row-bg {row === 0 ? 'rounded-tl' : ''} {row === 9
								? 'rounded-bl'
								: ''}"
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
								>
									<Square
										{square}
										size={effectiveCellSize}
										rowNumber={$numbers?.row_numbers[row]}
										colNumber={$numbers?.col_numbers[col]}
										isLocked={$party?.status !== 'filling'}
										isSelected={selectedCells.has(cellKey(row, col))}
										isPending={isSquarePending(row, col)}
										winners={getWinners(row, col)}
										onpointerdown={(e) => handlePointerDown(row, col, e)}
										onpointerenter={() => handlePointerMove(row, col)}
										onpointerup={() => handlePointerUp(row, col)}
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
			</div>

			<!-- Zoom Toggle (shown when horizontal scroll would occur) -->
			{#if showZoomControl}
				<button
					class="zoom-toggle-btn"
					onclick={() => (zoomState = zoomState === 'fit' ? 'zoomed' : 'fit')}
					aria-label={zoomState === 'fit' ? 'Zoom in for larger squares' : 'Fit grid to screen'}
				>
					{#if zoomState === 'fit'}
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="11" cy="11" r="8" />
							<path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
						</svg>
						<span>Zoom</span>
					{:else}
						<svg
							width="16"
							height="16"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
						</svg>
						<span>Fit</span>
					{/if}
				</button>
			{/if}
		</div>

		<!-- Players Section (mobile only - desktop uses sidebar) -->
		{#if $playerSummary.length > 0}
			<div class="players-section lg:hidden">
				<!-- Players Header / Toggle -->
				<button
					class="players-toggle"
					class:has-indicator={!hasInteractedWithPlayers && $playerSummary.length > 1}
					onclick={handlePlayersToggle}
				>
					<span class="players-label">
						Players ({$playerSummary.length})
						{#if $selectedPlayerFilter}
							<span class="filter-badge">filtering</span>
						{:else if !hasInteractedWithPlayers && isPlayersExpanded}
							<span class="hint-badge">tap to highlight</span>
						{/if}
					</span>
					<svg
						class="chevron"
						class:expanded={isPlayersExpanded}
						xmlns="http://www.w3.org/2000/svg"
						width="14"
						height="14"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
					>
						<polyline points="6 9 12 15 18 9"></polyline>
					</svg>
				</button>

				<!-- Expanded Player List -->
				{#if isPlayersExpanded}
					<div class="players-grid">
						{#each $playerSummary as player (player.normalizedName)}
							{@const color = getPlayerColor(player.name)}
							<button
								class="player-pill"
								class:selected={$selectedPlayerFilter === player.normalizedName}
								style="--player-bg: {color.bg}; --player-text: {color.text};"
								onclick={() => togglePlayerFilter(player.normalizedName)}
							>
								<div class="player-dot" style="background: {color.text};"></div>
								<span class="player-name">{player.name}</span>
								<span class="player-count">{player.count}</span>
							</button>
						{/each}
						{#if $party?.status === 'filling' && $availableCount > 0}
							<div class="available-count">
								{$availableCount} squares available
							</div>
						{/if}
					</div>
				{/if}
			</div>
		{/if}
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
		width: 32px;
	}

	.row-logo {
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

	/* Zoom Toggle Button */
	.zoom-toggle-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		font-size: 0.75rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		cursor: pointer;
		transition: all 150ms ease;
		min-height: 36px;
	}

	.zoom-toggle-btn svg {
		opacity: 0.8;
		flex-shrink: 0;
	}

	.zoom-toggle-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.zoom-toggle-btn:active {
		transform: scale(0.96);
	}

	/* Players Section */
	.players-section {
		border-top: 1px solid rgba(255, 255, 255, 0.06);
		padding-top: 0.75rem;
	}

	.players-toggle {
		position: relative;
		display: flex;
		align-items: center;
		justify-content: space-between;
		width: 100%;
		padding: 0.5rem 0.75rem;
		font-size: 0.8125rem;
		font-weight: 500;
		color: var(--text-secondary);
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	/* Pulse indicator for undiscovered feature */
	.players-toggle.has-indicator::after {
		content: '';
		position: absolute;
		top: -3px;
		right: -3px;
		width: 8px;
		height: 8px;
		background: rgba(100, 210, 200, 0.9);
		border-radius: 50%;
		animation: pulse-indicator 2s ease-in-out infinite;
	}

	@keyframes pulse-indicator {
		0%,
		100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.5;
			transform: scale(1.3);
		}
	}

	.players-toggle:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-primary);
	}

	.players-label {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.filter-badge {
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		background: rgba(100, 210, 200, 0.2);
		color: rgba(100, 210, 200, 0.95);
		border-radius: 4px;
	}

	.hint-badge {
		font-size: 0.625rem;
		padding: 0.125rem 0.375rem;
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-secondary);
		border-radius: 4px;
	}

	.chevron {
		transition: transform 200ms ease;
	}

	.chevron.expanded {
		transform: rotate(180deg);
	}

	/* Players Grid */
	.players-grid {
		display: flex;
		flex-direction: column;
		gap: 0.375rem;
		margin-top: 0.75rem;
	}

	.player-pill {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		background: rgba(255, 255, 255, 0.04);
		border: 1px solid rgba(255, 255, 255, 0.08);
		border-radius: 8px;
		font-size: 0.8125rem;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 200ms cubic-bezier(0.4, 0, 0.2, 1);
		min-height: 44px; /* Apple HIG touch target */
		width: 100%;
	}

	.player-pill:hover {
		background: rgba(255, 255, 255, 0.06);
		transform: translateY(-1px);
	}

	.player-pill.selected {
		background: var(--player-bg);
		border-color: var(--player-text);
		box-shadow: 0 0 12px color-mix(in srgb, var(--player-text) 30%, transparent);
	}

	.player-pill.selected .player-name,
	.player-pill.selected .player-count {
		color: var(--player-text);
		font-weight: 600;
	}

	.player-pill:active {
		transform: scale(0.97);
	}

	.player-dot {
		width: 10px;
		height: 10px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.player-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
	}

	.player-count {
		font-weight: 600;
		opacity: 0.8;
	}

	.available-count {
		grid-column: 1 / -1;
		text-align: center;
		padding: 0.5rem;
		font-size: 0.7rem;
		color: var(--text-secondary);
		opacity: 0.7;
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

		/* Multi-column player grid on larger screens */
		.players-grid {
			display: grid;
			grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
			gap: 0.5rem;
		}

		.player-pill {
			width: auto;
		}
	}

	/* Reduced motion support */
	@media (prefers-reduced-motion: reduce) {
		.square-wrapper,
		.player-pill,
		.chevron,
		.zoom-btn {
			transition: none;
		}

		.players-toggle.has-indicator::after {
			animation: none;
		}

		.square-wrapper.highlighted {
			filter: none;
			outline: 2px solid var(--player-text);
		}
	}
</style>
