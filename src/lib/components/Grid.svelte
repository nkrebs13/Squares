<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Square from './Square.svelte';
	import GestureHint from './GestureHint.svelte';
	import { squares, numbers, party, winners, claimSquare, claimSquaresBatch, unclaimSquare, mySquareCount, amountOwed } from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { userName } from '$lib/stores/user';
	import type { Square as SquareType, Winner } from '$lib/types';

	let gridContainer: HTMLDivElement;
	let gridWrapper: HTMLDivElement;
	let stickyColumnNumbers: HTMLDivElement;
	let stickyRowNumbers: HTMLDivElement;
	let panzoomInstance: any = null;
	let needsZoom = $state(false);
	let currentZoom = $state(1);

	// Double-tap detection
	let lastTapTime = 0;
	let lastTapX = 0;
	let lastTapY = 0;
	const DOUBLE_TAP_DELAY = 300;
	const DOUBLE_TAP_DISTANCE = 30;

	// Selection state
	let isDragging = $state(false);
	let selectedCells = $state<Set<string>>(new Set());
	let dragStartCell = $state<{ row: number; col: number } | null>(null);
	let isProcessing = $state(false);

	// Single tap timeout for disambiguation
	let singleTapTimeout: ReturnType<typeof setTimeout> | null = null;
	let pendingTapAction: (() => void) | null = null;

	// Long-press selection mode (Google Photos pattern)
	let longPressTimeout: ReturnType<typeof setTimeout> | null = null;
	let isInSelectionMode = $state(false);
	let longPressStartCell: { row: number; col: number } | null = null;
	const LONG_PRESS_DURATION = 500; // ms (industry standard)

	// Check if grid needs zoom (doesn't fit on screen or is touch device)
	function checkNeedsZoom() {
		if (!browser) return;

		// Always enable zoom on touch devices for better mobile UX
		const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		if (isTouchDevice) {
			needsZoom = true;
			return;
		}

		// For desktop size check, we need gridWrapper
		if (!gridWrapper) return;

		// On desktop, only enable if grid exceeds container
		const containerWidth = gridWrapper.parentElement?.clientWidth || window.innerWidth;
		const gridWidth = gridWrapper.scrollWidth;
		needsZoom = gridWidth > containerWidth + 20;
	}

	// Sync sticky column/row numbers with panzoom transform
	function syncStickyHeaders() {
		if (!panzoomInstance || !stickyColumnNumbers || !stickyRowNumbers) return;
		const { x, y, scale } = panzoomInstance.getTransform();

		// Column numbers: sync horizontal pan + scale
		stickyColumnNumbers.style.transform = `translateX(${x}px) scaleX(${scale})`;
		stickyColumnNumbers.style.transformOrigin = '0 0';

		// Row numbers: sync vertical pan + scale
		stickyRowNumbers.style.transform = `translateY(${y}px) scaleY(${scale})`;
		stickyRowNumbers.style.transformOrigin = '0 0';
	}

	onMount(() => {
		if (browser) {
			checkNeedsZoom();
			window.addEventListener('resize', checkNeedsZoom);
		}
	});

	$effect(() => {
		if (browser && gridContainer && needsZoom && !panzoomInstance) {
			import('panzoom').then((module) => {
				const panzoom = module.default;
				panzoomInstance = panzoom(gridContainer, {
					maxZoom: 3,
					minZoom: 0.5,
					bounds: true,
					boundsPadding: 0.1, // Tighter bounds - only 10% padding
					zoomDoubleClickSpeed: 1 // Disable built-in double-click zoom
				});

				// Listen for zoom changes
				panzoomInstance.on('zoom', () => {
					const transform = panzoomInstance.getTransform();
					currentZoom = transform.scale;
				});

				// Sync sticky headers with panzoom transform
				panzoomInstance.on('transform', syncStickyHeaders);
			});
		} else if (panzoomInstance && !needsZoom) {
			panzoomInstance.dispose();
			panzoomInstance = null;
			currentZoom = 1;
		}
	});

	// Disable panzoom during drag selection
	$effect(() => {
		if (panzoomInstance) {
			if (isDragging) {
				panzoomInstance.pause();
			} else {
				panzoomInstance.resume();
			}
		}
	});

	onDestroy(() => {
		if (browser) {
			window.removeEventListener('resize', checkNeedsZoom);
		}
		if (panzoomInstance) {
			panzoomInstance.dispose();
		}
		if (singleTapTimeout) {
			clearTimeout(singleTapTimeout);
		}
		if (longPressTimeout) {
			clearTimeout(longPressTimeout);
		}
	});

	function getSquare(row: number, col: number): SquareType | undefined {
		return $squares.find((s) => s.row_num === row && s.col_num === col);
	}

	function getWinner(row: number, col: number): Winner | null {
		if (!$numbers) return null;
		return (
			$winners.find((w) => {
				const winRow = $numbers!.row_numbers.indexOf(w.winning_row);
				const winCol = $numbers!.col_numbers.indexOf(w.winning_col);
				return winRow === row && winCol === col;
			}) || null
		);
	}

	function cellKey(row: number, col: number): string {
		return `${row}-${col}`;
	}

	function canSelectCell(row: number, col: number): boolean {
		if (!$userName || $party?.status !== 'filling') return false;
		const square = getSquare(row, col);
		return square !== undefined && square.player_name === null;
	}

	// Double-tap zoom handling
	function handleDoubleTap() {
		if (!panzoomInstance) return;

		const transform = panzoomInstance.getTransform();
		if (transform.scale < 1.5) {
			// Zoom in to 2x
			panzoomInstance.smoothZoomAbs(
				gridWrapper.clientWidth / 2,
				gridWrapper.clientHeight / 2,
				2
			);
		} else {
			// Zoom out AND reset position to origin
			panzoomInstance.moveTo(0, 0);
			panzoomInstance.zoomAbs(0, 0, 1);
			// Reset sticky headers to origin
			syncStickyHeaders();
		}
	}

	function handleGridTap(e: PointerEvent) {
		if (!needsZoom || !panzoomInstance) return;

		const now = Date.now();
		const x = e.clientX;
		const y = e.clientY;

		const timeDiff = now - lastTapTime;
		const distDiff = Math.sqrt(
			Math.pow(x - lastTapX, 2) + Math.pow(y - lastTapY, 2)
		);

		if (timeDiff < DOUBLE_TAP_DELAY && distDiff < DOUBLE_TAP_DISTANCE) {
			// Double tap detected
			if (singleTapTimeout) {
				clearTimeout(singleTapTimeout);
				singleTapTimeout = null;
				pendingTapAction = null;
			}
			handleDoubleTap();
			lastTapTime = 0;
		} else {
			lastTapTime = now;
			lastTapX = x;
			lastTapY = y;
		}
	}

	// Haptic feedback for selection mode
	function triggerHaptic() {
		if ('vibrate' in navigator) {
			navigator.vibrate(10); // Short 10ms pulse
		}
	}

	function handlePointerDown(row: number, col: number, e: PointerEvent) {
		if (!$userName || $party?.status !== 'filling') return;
		if (e.button !== 0) return;

		// Record tap for double-tap detection on the grid
		handleGridTap(e);

		// Store potential start cell for long-press
		longPressStartCell = { row, col };

		// Start long-press timer
		longPressTimeout = setTimeout(() => {
			// Long press triggered - enter selection mode
			isInSelectionMode = true;
			isDragging = true;
			dragStartCell = longPressStartCell;
			selectedCells = new Set();

			if (longPressStartCell && canSelectCell(longPressStartCell.row, longPressStartCell.col)) {
				selectedCells.add(cellKey(longPressStartCell.row, longPressStartCell.col));
			}

			// Haptic feedback
			triggerHaptic();

			longPressTimeout = null;
		}, LONG_PRESS_DURATION);
	}

	function handlePointerMove(row: number, col: number) {
		// If timer still running and moved to different cell, cancel (allow pan)
		if (longPressTimeout && longPressStartCell) {
			const startKey = cellKey(longPressStartCell.row, longPressStartCell.col);
			const currentKey = cellKey(row, col);
			if (startKey !== currentKey) {
				clearTimeout(longPressTimeout);
				longPressTimeout = null;
				longPressStartCell = null;
				return;
			}
		}

		// Extend selection if in selection mode
		if (isDragging && dragStartCell) {
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
		// Cancel long-press if not triggered yet
		if (longPressTimeout) {
			clearTimeout(longPressTimeout);
			longPressTimeout = null;

			// Short tap - handle as single square click
			if (longPressStartCell) {
				handleSquareClick(longPressStartCell.row, longPressStartCell.col);
			}
		}

		longPressStartCell = null;

		// End drag selection if active
		if (isDragging) {
			handleDragEnd();
			isInSelectionMode = false;
		}
	}

	async function handleDragEnd() {
		if (!isDragging) return;

		isDragging = false;
		dragStartCell = null;

		// Claim all selected squares in one batch call
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
		// Cancel long-press if active
		if (longPressTimeout) {
			clearTimeout(longPressTimeout);
			longPressTimeout = null;
		}
		longPressStartCell = null;

		if (isDragging) {
			handleDragEnd();
			isInSelectionMode = false;
		}
	}

	function handleGlobalPointerCancel() {
		// Cancel long-press if active
		if (longPressTimeout) {
			clearTimeout(longPressTimeout);
			longPressTimeout = null;
		}
		longPressStartCell = null;

		if (isDragging) {
			isDragging = false;
			dragStartCell = null;
			selectedCells = new Set();
			isInSelectionMode = false;
		}
	}

	// Accessibility zoom controls
	function zoomIn() {
		if (!panzoomInstance) return;
		const transform = panzoomInstance.getTransform();
		const newZoom = Math.min(transform.scale + 0.5, 3);
		panzoomInstance.smoothZoomAbs(
			gridWrapper.clientWidth / 2,
			gridWrapper.clientHeight / 2,
			newZoom
		);
	}

	function zoomOut() {
		if (!panzoomInstance) return;
		const transform = panzoomInstance.getTransform();
		const newZoom = Math.max(transform.scale - 0.5, 0.5);
		panzoomInstance.smoothZoomAbs(
			gridWrapper.clientWidth / 2,
			gridWrapper.clientHeight / 2,
			newZoom
		);
	}

	const rows = Array.from({ length: 10 }, (_, i) => i);
	const cols = Array.from({ length: 10 }, (_, i) => i);
</script>

<svelte:window
	onpointerup={handleGlobalPointerUp}
	onpointercancel={handleGlobalPointerCancel}
/>

<!-- Gesture hint for first-time visitors -->
<GestureHint />

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

	<!-- Grid Container -->
	<div class="grid-outer-container">
		<div class="overflow-hidden touch-none select-none rounded-xl" bind:this={gridWrapper}>
			<!-- Column Team Header (outside panzoom) -->
			<div class="flex items-center justify-center gap-2 py-3 mb-1">
				<img
					src="/logos/patriots.svg"
					alt="{$theme.colName}"
					class="w-6 h-6 sm:w-7 sm:h-7 object-contain"
					onerror={(e) => (e.currentTarget as HTMLElement).style.display = 'none'}
				/>
				<span class="font-bold text-base sm:text-lg" style="color: {$theme.colColor}">
					{$theme.colName}
				</span>
			</div>

			<!-- Grid Layout: Row header + Numbers + Squares -->
			<div class="flex gap-1">
				<!-- Row Team Header (vertical, outside panzoom) -->
				<div class="flex flex-col items-center justify-center gap-2 pr-1">
					<img
						src="/logos/seahawks.svg"
						alt="{$theme.rowName}"
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

				<!-- Main Grid Area -->
				<div class="flex-1 overflow-hidden">
					<!-- Sticky Column Numbers (outside panzoom, synced via JS) -->
					<div bind:this={stickyColumnNumbers} class="sticky-column-numbers">
						<div class="grid grid-cols-[auto_repeat(10,1fr)] gap-0.5 mb-0.5">
							<div class="w-7 sm:w-8 md:w-10"></div>
							{#each cols as col}
								<div
									class="h-7 sm:h-8 md:h-10 flex items-center justify-center text-xs sm:text-sm font-bold text-white team-col-bg {col === 0 ? 'rounded-tl-lg' : ''} {col === 9 ? 'rounded-tr-lg' : ''}"
								>
									{$numbers ? $numbers.col_numbers[col] : '?'}
								</div>
							{/each}
						</div>
					</div>

					<!-- Content area with row numbers + grid -->
					<div class="flex">
						<!-- Sticky Row Numbers (outside panzoom, synced via JS) -->
						<div bind:this={stickyRowNumbers} class="sticky-row-numbers">
							{#each rows as row}
								<div class="grid grid-cols-[auto] gap-0.5 {row < 9 ? 'mb-0.5' : ''}">
									<div
										class="w-7 sm:w-8 md:w-10 h-7 sm:h-8 md:h-10 flex items-center justify-center text-xs sm:text-sm font-bold text-white team-row-bg {row === 0 ? 'rounded-tl-lg' : ''} {row === 9 ? 'rounded-bl-lg' : ''}"
									>
										{$numbers ? $numbers.row_numbers[row] : '?'}
									</div>
								</div>
							{/each}
						</div>

						<!-- Panzoom Target: Grid Squares Only -->
						<div bind:this={gridContainer} class="grid-squares-container">
							{#each rows as row}
								<div class="grid grid-cols-[repeat(10,1fr)] gap-0.5 {row < 9 ? 'mb-0.5' : ''}">
									{#each cols as col}
										{@const square = getSquare(row, col)}
										{#if square}
											<Square
												{square}
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
								</div>
							{/each}
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Accessibility Zoom Controls -->
		{#if needsZoom}
			<div class="zoom-controls">
				<button
					class="zoom-btn"
					onclick={zoomOut}
					aria-label="Zoom out"
					disabled={currentZoom <= 0.5}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
						<line x1="8" y1="11" x2="14" y2="11"></line>
					</svg>
				</button>
				<button
					class="zoom-btn"
					onclick={zoomIn}
					aria-label="Zoom in"
					disabled={currentZoom >= 3}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
						<line x1="11" y1="8" x2="11" y2="14"></line>
						<line x1="8" y1="11" x2="14" y2="11"></line>
					</svg>
				</button>
			</div>
		{/if}
	</div>

	<!-- Selection info during drag -->
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

	.grid-outer-container {
		position: relative;
	}

	.sticky-column-numbers {
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--bg-primary);
		transform-origin: 0 0;
	}

	.sticky-row-numbers {
		position: sticky;
		left: 0;
		z-index: 20;
		background: var(--bg-primary);
		transform-origin: 0 0;
		flex-shrink: 0;
	}

	.grid-squares-container {
		flex: 1;
		min-width: fit-content;
	}

	.zoom-controls {
		position: fixed;
		bottom: max(1rem, env(safe-area-inset-bottom, 0px));
		right: max(1rem, env(safe-area-inset-right, 0px));
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		z-index: 100;
	}

	.zoom-btn {
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: rgba(26, 26, 36, 0.85);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.1);
		border-radius: 12px;
		color: var(--text-secondary);
		cursor: pointer;
		transition: all 200ms ease;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
	}

	.zoom-btn:hover:not(:disabled) {
		background: rgba(26, 26, 36, 0.95);
		color: var(--text-primary);
		border-color: rgba(100, 210, 200, 0.3);
	}

	.zoom-btn:active:not(:disabled) {
		transform: scale(0.95);
	}

	.zoom-btn:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
