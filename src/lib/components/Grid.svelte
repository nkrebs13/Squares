<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { browser } from '$app/environment';
	import Square from './Square.svelte';
	import { squares, numbers, party, winners, claimSquare, claimSquaresBatch, unclaimSquare, mySquareCount, amountOwed } from '$lib/stores/game';
	import { theme } from '$lib/stores/theme';
	import { userName } from '$lib/stores/user';
	import type { Square as SquareType, Winner } from '$lib/types';

	let gridContainer: HTMLDivElement;
	let gridWrapper: HTMLDivElement;
	let panzoomInstance: any = null;
	let needsZoom = $state(false);

	// Selection state
	let isDragging = $state(false);
	let selectedCells = $state<Set<string>>(new Set());
	let dragStartCell = $state<{ row: number; col: number } | null>(null);
	let isProcessing = $state(false);

	// Check if grid needs zoom (doesn't fit on screen)
	function checkNeedsZoom() {
		if (!gridWrapper || !browser) return;
		const containerWidth = gridWrapper.parentElement?.clientWidth || window.innerWidth;
		const gridWidth = gridWrapper.scrollWidth;
		needsZoom = gridWidth > containerWidth + 20; // 20px tolerance
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
					boundsPadding: 0.5
				});
			});
		} else if (panzoomInstance && !needsZoom) {
			panzoomInstance.dispose();
			panzoomInstance = null;
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

	function handleDragStart(row: number, col: number, e: PointerEvent) {
		if (!$userName || $party?.status !== 'filling') return;
		if (e.button !== 0) return;
		e.preventDefault();

		isDragging = true;
		dragStartCell = { row, col };
		selectedCells = new Set();

		if (canSelectCell(row, col)) {
			selectedCells.add(cellKey(row, col));
		}
	}

	function handleDragMove(row: number, col: number) {
		if (!isDragging || !dragStartCell) return;

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
		if (isDragging) {
			handleDragEnd();
		}
	}

	function handleGlobalPointerCancel() {
		if (isDragging) {
			isDragging = false;
			dragStartCell = null;
			selectedCells = new Set();
		}
	}

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

	<!-- Grid Container -->
	<div class="overflow-auto touch-none select-none rounded-xl" bind:this={gridWrapper}>
		<div bind:this={gridContainer} class="inline-block min-w-full">
			<!-- Column Team Header -->
			<div class="flex items-center justify-center gap-2 py-3 mb-1">
				<img
					src="/logos/patriots.svg"
					alt="{$theme.colName}"
					class="w-6 h-6 sm:w-7 sm:h-7 object-contain"
					onerror={(e) => e.currentTarget.style.display = 'none'}
				/>
				<span class="font-bold text-base sm:text-lg" style="color: {$theme.colColor}">
					{$theme.colName}
				</span>
			</div>

			<!-- Grid Layout: Row header + Numbers + Squares -->
			<div class="flex gap-1">
				<!-- Row Team Header (vertical) -->
				<div class="flex flex-col items-center justify-center gap-2 pr-1">
					<img
						src="/logos/seahawks.svg"
						alt="{$theme.rowName}"
						class="w-6 h-6 sm:w-7 sm:h-7 object-contain"
						onerror={(e) => e.currentTarget.style.display = 'none'}
					/>
					<span
						class="font-bold text-sm sm:text-base writing-vertical flex-1 flex items-center"
						style="color: {$theme.rowColor}"
					>
						{$theme.rowName}
					</span>
				</div>

				<!-- Main Grid Area with integrated row numbers -->
				<div class="flex-1">
					<!-- Column Numbers Row (with empty cell for row number column) -->
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

					<!-- Grid Squares with row numbers -->
					{#each rows as row}
						<div class="grid grid-cols-[auto_repeat(10,1fr)] gap-0.5 {row < 9 ? 'mb-0.5' : ''}">
							<!-- Row number -->
							<div
								class="w-7 sm:w-8 md:w-10 flex items-center justify-center text-xs sm:text-sm font-bold text-white team-row-bg {row === 0 ? 'rounded-tl-lg' : ''} {row === 9 ? 'rounded-bl-lg' : ''}"
							>
								{$numbers ? $numbers.row_numbers[row] : '?'}
							</div>
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
										onclick={() => handleSquareClick(row, col)}
										onpointerdown={(e) => handleDragStart(row, col, e)}
										onpointerenter={() => handleDragMove(row, col)}
									/>
								{/if}
							{/each}
						</div>
					{/each}
				</div>
			</div>
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
</style>
