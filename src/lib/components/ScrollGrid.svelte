<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Square from './Square.svelte';
	import GestureHint from './GestureHint.svelte';
	import { squares, numbers, party, winners, claimSquare, claimSquaresBatch, unclaimSquare, mySquareCount, amountOwed } from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { userName } from '$lib/stores/user';
	import type { Square as SquareType, Winner } from '$lib/types';

	let gridWrapper: HTMLDivElement;

	// Selection state
	let isDragging = $state(false);
	let selectedCells = $state<Set<string>>(new Set());
	let dragStartCell = $state<{ row: number; col: number } | null>(null);
	let isProcessing = $state(false);

	// Long-press selection mode
	let longPressTimeout: ReturnType<typeof setTimeout> | null = null;
	let isInSelectionMode = $state(false);
	let longPressStartCell: { row: number; col: number } | null = null;
	const LONG_PRESS_DURATION = 500;

	// Track if a pointer is down on a selectable cell - used to prevent scroll
	let isPointerDownOnCell = $state(false);

	onDestroy(() => {
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

	// Haptic feedback
	function triggerHaptic() {
		if ('vibrate' in navigator) {
			navigator.vibrate(10);
		}
	}

	function handlePointerDown(row: number, col: number, e: PointerEvent) {
		if (!$userName || $party?.status !== 'filling') return;
		if (e.button !== 0) return;

		longPressStartCell = { row, col };

		// Prevent scroll while detecting long-press on empty cells
		if (canSelectCell(row, col)) {
			isPointerDownOnCell = true;
		}

		longPressTimeout = setTimeout(() => {
			isInSelectionMode = true;
			isDragging = true;
			dragStartCell = longPressStartCell;
			selectedCells = new Set();

			if (longPressStartCell && canSelectCell(longPressStartCell.row, longPressStartCell.col)) {
				selectedCells.add(cellKey(longPressStartCell.row, longPressStartCell.col));
			}

			triggerHaptic();
			longPressTimeout = null;
		}, LONG_PRESS_DURATION);
	}

	function handlePointerMove(row: number, col: number) {
		if (longPressTimeout && longPressStartCell) {
			const startKey = cellKey(longPressStartCell.row, longPressStartCell.col);
			const currentKey = cellKey(row, col);
			if (startKey !== currentKey) {
				clearTimeout(longPressTimeout);
				longPressTimeout = null;
				longPressStartCell = null;
				isPointerDownOnCell = false;
				return;
			}
		}

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
		isPointerDownOnCell = false;

		if (longPressTimeout) {
			clearTimeout(longPressTimeout);
			longPressTimeout = null;

			if (longPressStartCell) {
				handleSquareClick(longPressStartCell.row, longPressStartCell.col);
			}
		}

		longPressStartCell = null;

		if (isDragging) {
			handleDragEnd();
			isInSelectionMode = false;
		}
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
		isPointerDownOnCell = false;

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
		isPointerDownOnCell = false;

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

	const rows = Array.from({ length: 10 }, (_, i) => i);
	const cols = Array.from({ length: 10 }, (_, i) => i);
</script>

<svelte:window
	onpointerup={handleGlobalPointerUp}
	onpointercancel={handleGlobalPointerCancel}
/>

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

	<!-- Scrollable Grid Container -->
	<div class="scroll-grid-container" bind:this={gridWrapper}>
		<!-- Column Team Header -->
		<div class="scroll-grid-header">
			<div class="corner-spacer"></div>
			<div class="col-header-content">
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
		</div>

		<div class="scroll-grid-body">
			<!-- Row Team Header (vertical) -->
			<div class="row-header">
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

			<!-- Scrollable Grid Area -->
			<div class="scroll-area" class:touch-none={isPointerDownOnCell || isInSelectionMode}>
				<div class="grid-with-headers" class:touch-none={isPointerDownOnCell || isInSelectionMode}>
					<!-- Column Numbers Row -->
					<div class="col-numbers-row">
						<div class="row-number-spacer"></div>
						{#each cols as col}
							<div class="col-number team-col-bg {col === 0 ? 'rounded-tl-lg' : ''} {col === 9 ? 'rounded-tr-lg' : ''}">
								{$numbers ? $numbers.col_numbers[col] : '?'}
							</div>
						{/each}
					</div>

					<!-- Grid Rows -->
					{#each rows as row}
						<div class="grid-row">
							<!-- Row Number -->
							<div class="row-number team-row-bg {row === 0 ? 'rounded-tl-lg' : ''} {row === 9 ? 'rounded-bl-lg' : ''}">
								{$numbers ? $numbers.row_numbers[row] : '?'}
							</div>
							<!-- Squares -->
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

	.scroll-grid-container {
		border-radius: 12px;
		overflow: hidden;
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
	}

	.scroll-grid-header {
		display: flex;
		align-items: center;
		padding: 0.75rem;
		border-bottom: 1px solid var(--border-color);
	}

	.corner-spacer {
		width: 2.5rem;
		flex-shrink: 0;
	}

	.col-header-content {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		flex: 1;
	}

	.scroll-grid-body {
		display: flex;
	}

	.row-header {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.5rem;
		padding: 0.5rem;
		border-right: 1px solid var(--border-color);
		flex-shrink: 0;
	}

	.scroll-area {
		flex: 1;
		overflow: auto;
		-webkit-overflow-scrolling: touch;
		overscroll-behavior: contain;
		max-height: 70vh;
	}

	.touch-none {
		touch-action: none;
		-webkit-overflow-scrolling: auto;
		overflow: hidden;
	}

	.grid-with-headers {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.25rem;
		min-width: max-content;
	}

	.col-numbers-row {
		display: flex;
		gap: 2px;
		position: sticky;
		top: 0;
		z-index: 10;
		background: var(--bg-secondary);
		padding-bottom: 2px;
	}

	.row-number-spacer {
		width: 1.75rem;
		flex-shrink: 0;
	}

	.col-number {
		/* Must match square width exactly */
		min-width: 2.75rem;
		width: 2.75rem;
		height: 1.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: bold;
		color: white;
		flex-shrink: 0;
	}

	@media (min-width: 640px) {
		.col-number {
			min-width: 2.875rem;
			width: 2.875rem;
			height: 1.875rem;
		}
	}

	@media (min-width: 768px) {
		.col-number {
			min-width: 3rem;
			width: 3rem;
			height: 2rem;
			font-size: 0.875rem;
		}
		.row-number-spacer {
			width: 2rem;
		}
	}

	.grid-row {
		display: flex;
		gap: 2px;
	}

	.row-number {
		/* Must match square height exactly */
		width: 1.75rem;
		min-height: 2.75rem;
		height: 2.75rem;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.75rem;
		font-weight: bold;
		color: white;
		flex-shrink: 0;
		position: sticky;
		left: 0;
		z-index: 5;
	}

	@media (min-width: 640px) {
		.row-number {
			min-height: 2.875rem;
			height: 2.875rem;
			width: 1.875rem;
		}
	}

	@media (min-width: 768px) {
		.row-number {
			width: 2rem;
			min-height: 3rem;
			height: 3rem;
			font-size: 0.875rem;
		}
	}

	.grid-legend {
		display: flex;
		justify-content: center;
		gap: 1rem;
		padding: 0.75rem;
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
</style>
