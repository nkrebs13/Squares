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
	let horizontalTeamLabel: HTMLDivElement;
	let verticalTeamLabel: HTMLDivElement;
	let panzoomInstance: any = null;
	let needsZoom = $state(false);
	let currentZoom = $state(1);
	let showZoomIndicator = $state(false);
	let zoomIndicatorTimeout: ReturnType<typeof setTimeout> | null = null;
	let resizeObserver: ResizeObserver | null = null;
	let resizeHandler: (() => void) | null = null;
	let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
	let minZoom = $state(1);

	// Dynamic cell sizing - pure JS calculation, no breakpoints
	let cellSize = $state(44); // Default mobile size (Apple HIG minimum)
	let headerHeight = $state(28); // Column/row header height
	const MIN_CELL_SIZE = 44; // Apple HIG minimum touch target
	const ROW_HEADER_WIDTH = 32; // Width of row number column
	const GAP_SIZE = 2; // Gap between cells
	const BASE_LABEL_GAP = 16; // Fixed gap between team labels and grid (per Material/HIG guidelines)
	const VERTICAL_LABEL_WIDTH_FALLBACK = 40; // Fallback for vertical team label width
	const HORIZONTAL_LABEL_HEIGHT_FALLBACK = 48; // Fallback for horizontal team label height
	const NUM_COLS = 10;
	const NUM_GAPS = NUM_COLS - 1; // 9 gaps between 10 columns

	// Dynamic max based on viewport - no cap on desktop
	function getMaxCellSize(): number {
		if (!browser) return 80;
		// On desktop (>1024px), allow cells to fill available space (cap at 120px for aesthetics)
		// On mobile/tablet, keep 80px max for touch usability
		return window.innerWidth > 1024 ? 120 : 80;
	}

	// Calculate cell size based on available width - pure math, no breakpoints
	function calculateCellSize() {
		if (!browser || !gridWrapper) return;

		// Account for vertical team label width + gap (use measured value or fallback)
		const verticalLabelWidth = (verticalTeamLabel?.offsetWidth || VERTICAL_LABEL_WIDTH_FALLBACK) + BASE_LABEL_GAP;
		const availableWidth = gridWrapper.clientWidth - verticalLabelWidth;
		const gapTotal = NUM_GAPS * GAP_SIZE;
		const gridWidth = availableWidth - ROW_HEADER_WIDTH - gapTotal - 8; // 8px padding

		// Pure calculation: available width / 10 columns, clamped to min/max
		const maxSize = getMaxCellSize();
		const size = Math.min(Math.max(Math.floor(gridWidth / NUM_COLS), MIN_CELL_SIZE), maxSize);
		cellSize = size;

		// Header height scales proportionally (70% of cell size, min 24px)
		headerHeight = Math.max(Math.floor(size * 0.7), 24);
	}

	// Predefined zoom levels for snap behavior
	const ZOOM_LEVELS = [1, 1.5, 2];
	const ZOOM_TOLERANCE = 0.01; // Tolerance for floating-point comparison in zoom levels

	// Show zoom indicator briefly
	function flashZoomIndicator() {
		showZoomIndicator = true;
		if (zoomIndicatorTimeout) {
			clearTimeout(zoomIndicatorTimeout);
		}
		zoomIndicatorTimeout = setTimeout(() => {
			showZoomIndicator = false;
		}, 1500);
	}

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

	// Long-press selection mode (Google Photos pattern)
	let longPressTimeout: ReturnType<typeof setTimeout> | null = null;
	let isInSelectionMode = $state(false);
	let longPressStartCell: { row: number; col: number } | null = null;
	const LONG_PRESS_DURATION = 350; // ms (faster for better UX)

	// Track touch coordinates for long-press cancellation on pan
	let longPressStartX = 0;
	let longPressStartY = 0;
	const LONG_PRESS_DISTANCE_THRESHOLD = 20; // pixels - forgiving for tremor/movement on mobile

	// Visual feedback state for long-press
	let pressedCell = $state<{ row: number; col: number } | null>(null);
	let pressStartTime = $state(0);
	let pressProgress = $state(0);
	let pressAnimationFrame: number | null = null;
	let isMounted = false; // Guard for async operations after unmount

	// Animate progress ring during long-press
	function startPressAnimation() {
		pressStartTime = Date.now();
		const animate = () => {
			const elapsed = Date.now() - pressStartTime;
			pressProgress = Math.min(elapsed / LONG_PRESS_DURATION, 1);

			if (pressProgress < 1 && pressedCell) {
				pressAnimationFrame = requestAnimationFrame(animate);
			}
		};
		pressAnimationFrame = requestAnimationFrame(animate);
	}

	function stopPressAnimation() {
		// Set state first to prevent animation callback from continuing
		pressedCell = null;
		pressProgress = 0;
		if (pressAnimationFrame) {
			cancelAnimationFrame(pressAnimationFrame);
			pressAnimationFrame = null;
		}
	}

	// Detect if device has touch capability
	let isTouchDevice = $state(false);

	// Check if grid needs zoom/pan (doesn't fit on screen or is touch device)
	function checkNeedsZoom() {
		if (!browser) return;

		// Always enable zoom on touch devices for better mobile UX
		isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
		if (isTouchDevice) {
			needsZoom = true;
			return;
		}

		// For size check, we need gridWrapper
		if (!gridWrapper) return;

		// Account for team label dimensions + gaps
		const verticalLabelWidth = (verticalTeamLabel?.offsetWidth || VERTICAL_LABEL_WIDTH_FALLBACK) + BASE_LABEL_GAP;
		const horizontalLabelHeight = (horizontalTeamLabel?.offsetHeight || HORIZONTAL_LABEL_HEIGHT_FALLBACK) + BASE_LABEL_GAP;

		// Calculate actual grid dimensions from cell size (more reliable than scrollWidth)
		const actualGridWidth = (cellSize * NUM_COLS) + (GAP_SIZE * NUM_GAPS) + ROW_HEADER_WIDTH;
		const actualGridHeight = (cellSize * NUM_COLS) + (GAP_SIZE * NUM_GAPS) + headerHeight;
		const containerWidth = gridWrapper.clientWidth - verticalLabelWidth;
		const containerHeight = gridWrapper.clientHeight - horizontalLabelHeight;

		// Enable panzoom if grid doesn't fit in container (check both dimensions)
		needsZoom = actualGridWidth > containerWidth || actualGridHeight > containerHeight;
	}

	// Sync sticky column/row numbers and team label gaps with panzoom transform
	function syncZoomElements() {
		if (!panzoomInstance || !stickyColumnNumbers || !stickyRowNumbers) return;
		const { x, y, scale } = panzoomInstance.getTransform();

		// Column numbers: sync horizontal pan + scale
		stickyColumnNumbers.style.transform = `translateX(${x}px) scaleX(${scale})`;
		stickyColumnNumbers.style.transformOrigin = '0 0';

		// Row numbers: sync vertical pan + scale
		stickyRowNumbers.style.transform = `translateY(${y}px) scaleY(${scale})`;
		stickyRowNumbers.style.transformOrigin = '0 0';

		// Scale team label gaps proportionally with zoom
		// This keeps the visual gap consistent relative to the scaled grid
		const scaledGap = BASE_LABEL_GAP * scale;
		if (horizontalTeamLabel) {
			horizontalTeamLabel.style.marginBottom = `${scaledGap}px`;
		}
		if (verticalTeamLabel) {
			verticalTeamLabel.style.paddingRight = `${scaledGap}px`;
		}
	}

	// Calculate actual grid dimensions from cell size (more accurate than scrollWidth)
	function getActualGridDimensions() {
		// Grid = 10 cells + 9 gaps
		const width = (cellSize * NUM_COLS) + (GAP_SIZE * NUM_GAPS);
		const height = (cellSize * NUM_COLS) + (GAP_SIZE * NUM_GAPS); // 10 rows
		return { width, height };
	}

	// Calculate minZoom to fit entire grid in viewport
	function calculateMinZoom(): number {
		if (!browser || !gridWrapper) return 1;

		const gridDims = getActualGridDimensions();

		// Account for all fixed elements (team labels + headers + gaps)
		// At 1.0 scale, gaps are BASE_LABEL_GAP pixels
		const verticalLabelWidth = (verticalTeamLabel?.offsetWidth || VERTICAL_LABEL_WIDTH_FALLBACK) + BASE_LABEL_GAP;
		const horizontalLabelHeight = (horizontalTeamLabel?.offsetHeight || HORIZONTAL_LABEL_HEIGHT_FALLBACK) + BASE_LABEL_GAP;

		// Guard against zero/negative dimensions during initial layout
		const wrapperWidth = Math.max(1, gridWrapper.clientWidth - verticalLabelWidth - ROW_HEADER_WIDTH);
		const wrapperHeight = Math.max(1, gridWrapper.clientHeight - horizontalLabelHeight - headerHeight);

		// Find scale where grid fits in both dimensions
		const scaleX = wrapperWidth / gridDims.width;
		const scaleY = wrapperHeight / gridDims.height;

		// Use smaller scale to fit entire grid, minimum 0.5 for usability
		return Math.max(0.5, Math.min(scaleX, scaleY, 1));
	}

	// Custom bounds enforcement - mobile-optimized, allows reaching all columns
	function enforceCustomBounds() {
		if (!panzoomInstance || !gridWrapper || !gridContainer) return;

		const { x, y, scale } = panzoomInstance.getTransform();

		const wrapperRect = gridWrapper.getBoundingClientRect();
		const gridDims = getActualGridDimensions();
		const scaledWidth = gridDims.width * scale;
		const scaledHeight = gridDims.height * scale;

		// Padding at edges - allows a bit of overscroll for native feel
		const EDGE_PADDING = 16;

		let clampedX = x;
		let clampedY = y;

		// Get actual dimensions of fixed elements (team labels)
		// Note: offsetWidth/Height don't include margins/padding used as gaps, so we add the scaled gap
		const scaledGap = BASE_LABEL_GAP * scale;
		const verticalLabelWidth = (verticalTeamLabel?.offsetWidth || VERTICAL_LABEL_WIDTH_FALLBACK) + scaledGap;
		const horizontalLabelHeight = (horizontalTeamLabel?.offsetHeight || HORIZONTAL_LABEL_HEIGHT_FALLBACK) + scaledGap;

		// Account for vertical team label AND sticky row header width in available viewport
		const availableWidth = Math.max(1, wrapperRect.width - verticalLabelWidth - ROW_HEADER_WIDTH);
		if (scaledWidth > availableWidth) {
			// Grid larger than container - allow panning to see ALL content
			// minX: how far left we can pan (to see right edge of grid)
			// maxX: how far right we can pan (to see left edge of grid)
			const minX = availableWidth - scaledWidth - EDGE_PADDING;
			const maxX = EDGE_PADDING;
			clampedX = Math.max(minX, Math.min(maxX, x));
		} else {
			// Grid fits or smaller - center it with minimal drift
			const centerX = (availableWidth - scaledWidth) / 2;
			clampedX = centerX; // Lock to center when grid fits
		}

		// Account for horizontal team label AND sticky column header height in available viewport
		const availableHeight = Math.max(1, wrapperRect.height - horizontalLabelHeight - headerHeight);
		if (scaledHeight > availableHeight) {
			// Grid taller than container - allow panning to see all rows
			const minY = availableHeight - scaledHeight - EDGE_PADDING;
			const maxY = EDGE_PADDING;
			clampedY = Math.max(minY, Math.min(maxY, y));
		} else {
			// Grid fits - center it
			const centerY = (availableHeight - scaledHeight) / 2;
			clampedY = centerY;
		}

		if (clampedX !== x || clampedY !== y) {
			panzoomInstance.moveTo(clampedX, clampedY);
		}
	}

	onMount(() => {
		isMounted = true;

		if (browser) {
			// Defer initial calculations to after first paint (avoid layout race)
			requestAnimationFrame(() => {
				if (!isMounted) return;
				calculateCellSize();
				checkNeedsZoom();
				minZoom = calculateMinZoom();
			});

			// Store resize handler for proper cleanup
			resizeHandler = () => {
				calculateCellSize();
				checkNeedsZoom();
				minZoom = calculateMinZoom();
				// Update panzoom minZoom if instance exists
				if (panzoomInstance) {
					panzoomInstance.setMinZoom(minZoom);
				}
			};
			window.addEventListener('resize', resizeHandler);

			// Set up ResizeObserver with debouncing for continuous sizing
			if (gridWrapper) {
				resizeObserver = new ResizeObserver(() => {
					if (resizeTimeout) clearTimeout(resizeTimeout);
					resizeTimeout = setTimeout(() => {
						if (!isMounted) return;
						calculateCellSize();
						checkNeedsZoom();
						minZoom = calculateMinZoom();
						// Update panzoom minZoom if instance exists
						if (panzoomInstance) {
							panzoomInstance.setMinZoom(minZoom);
						}
					}, 16); // One frame at 60fps for responsive resize
				});
				resizeObserver.observe(gridWrapper);
			}
		}
	});

	$effect(() => {
		if (browser && gridContainer && needsZoom && !panzoomInstance) {
			import('panzoom').then((module) => {
				// Guard against component unmount during async import
				if (!isMounted) return;

				// Defer to next frame to ensure layout is complete
				requestAnimationFrame(() => {
					if (!isMounted) return;

					const panzoom = module.default;
					panzoomInstance = panzoom(gridContainer, {
						maxZoom: 2,
						minZoom: calculateMinZoom(), // Dynamic based on grid/viewport
						// Disable scroll/pinch zoom - use buttons and double-tap only
						beforeWheel: () => true, // Return true to prevent wheel zoom
						beforeMouseDown: (e: MouseEvent) => {
							// Allow panning with mouse
							return false;
						},
						pinchSpeed: 0, // Disable pinch zoom
						zoomDoubleClickSpeed: 1, // Disable built-in double-click zoom (we handle it ourselves)
						// Smooth panning settings for mobile
						smoothScroll: false, // We handle our own bounds
						filterKey: () => true // Allow all key events through
					});

					// Listen for zoom changes
					panzoomInstance.on('zoom', () => {
						const transform = panzoomInstance.getTransform();
						currentZoom = transform.scale;
						flashZoomIndicator();
					});

					// Sync sticky headers and enforce bounds on every transform
					// Direct sync (no RAF throttle) prevents visual desync/jank
					panzoomInstance.on('transform', () => {
						syncZoomElements();
						enforceCustomBounds();
					});

					// Initial position - center the grid or align left on mobile
					requestAnimationFrame(() => {
						enforceCustomBounds();
						syncZoomElements();
					});
				});
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
		isMounted = false; // Prevent async callbacks from running

		if (browser && resizeHandler) {
			window.removeEventListener('resize', resizeHandler);
		}
		if (resizeObserver) {
			resizeObserver.disconnect();
		}
		if (resizeTimeout) {
			clearTimeout(resizeTimeout);
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
		if (zoomIndicatorTimeout) {
			clearTimeout(zoomIndicatorTimeout);
		}
		if (pressAnimationFrame) {
			cancelAnimationFrame(pressAnimationFrame);
		}
	});

	// Derived lookup maps for O(1) access (avoids 100x O(n) lookups per render)
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

	// Double-tap zoom handling - zooms toward tap location for native-like UX
	function handleDoubleTap() {
		if (!panzoomInstance) return;

		const transform = panzoomInstance.getTransform();
		if (transform.scale < 1.5) {
			// Zoom in to 2x toward the tap location
			// Convert page coordinates to wrapper-relative coordinates
			const wrapperRect = gridWrapper.getBoundingClientRect();
			const zoomX = lastTapX - wrapperRect.left;
			const zoomY = lastTapY - wrapperRect.top;
			panzoomInstance.smoothZoomAbs(zoomX, zoomY, 2);
		} else {
			// Zoom out AND reset position to origin
			panzoomInstance.moveTo(0, 0);
			panzoomInstance.zoomAbs(0, 0, 1);
			// Reset sticky headers to origin
			syncZoomElements();
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

		// Store potential start cell and coordinates for long-press
		longPressStartCell = { row, col };
		longPressStartX = e.clientX;
		longPressStartY = e.clientY;

		// On desktop with Shift key, start drag selection immediately
		if (!isTouchDevice && e.shiftKey && canSelectCell(row, col)) {
			isInSelectionMode = true;
			isDragging = true;
			dragStartCell = { row, col };
			selectedCells = new Set([cellKey(row, col)]);
			return;
		}

		// Start visual feedback immediately if cell can be selected
		if (canSelectCell(row, col)) {
			pressedCell = { row, col };
			startPressAnimation();
		}

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

			// Stop press animation (selection mode takes over)
			stopPressAnimation();

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
				stopPressAnimation();
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
		// Stop press animation
		stopPressAnimation();

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
		// Stop press animation
		stopPressAnimation();

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
		// Stop press animation
		stopPressAnimation();

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

	// Check pixel distance during long-press to cancel on pan
	function handleGlobalPointerMove(e: PointerEvent) {
		if (longPressTimeout) {
			const distMoved = Math.sqrt(
				Math.pow(e.clientX - longPressStartX, 2) +
				Math.pow(e.clientY - longPressStartY, 2)
			);
			if (distMoved > LONG_PRESS_DISTANCE_THRESHOLD) {
				clearTimeout(longPressTimeout);
				longPressTimeout = null;
				longPressStartCell = null;
				stopPressAnimation();
			}
		}
	}

	// Accessibility zoom controls with snap-to-level behavior
	function getNextZoomLevel(direction: 'in' | 'out'): number {
		const transform = panzoomInstance.getTransform();
		const current = transform.scale;

		// Build dynamic zoom levels including minZoom if it's below 1.0
		const levels = minZoom < 1 ? [minZoom, ...ZOOM_LEVELS] : ZOOM_LEVELS;

		if (direction === 'in') {
			// Find next higher zoom level
			for (const level of levels) {
				if (level > current + 0.05) return level;
			}
			return levels[levels.length - 1];
		} else {
			// Find next lower zoom level
			for (let i = levels.length - 1; i >= 0; i--) {
				if (levels[i] < current - 0.05) return levels[i];
			}
			return minZoom;
		}
	}

	function zoomIn() {
		if (!panzoomInstance) return;
		const newZoom = getNextZoomLevel('in');
		panzoomInstance.smoothZoomAbs(
			gridWrapper.clientWidth / 2,
			gridWrapper.clientHeight / 2,
			newZoom
		);
	}

	function zoomOut() {
		if (!panzoomInstance) return;
		const newZoom = getNextZoomLevel('out');
		panzoomInstance.smoothZoomAbs(
			gridWrapper.clientWidth / 2,
			gridWrapper.clientHeight / 2,
			newZoom
		);
	}

	function resetZoom() {
		if (!panzoomInstance) return;
		panzoomInstance.moveTo(0, 0);
		panzoomInstance.zoomAbs(0, 0, 1);
		syncZoomElements();
	}

	const rows = Array.from({ length: 10 }, (_, i) => i);
	const cols = Array.from({ length: 10 }, (_, i) => i);
</script>

<svelte:window
	onpointermove={handleGlobalPointerMove}
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
	<div class="grid-outer-container" style="--cell-size: {cellSize}px; --header-height: {headerHeight}px; --row-header-width: {ROW_HEADER_WIDTH}px;">
		<div class="overflow-hidden select-none rounded-xl" style="touch-action: none;" bind:this={gridWrapper}>
			<!-- Column Team Header (outside panzoom) -->
			<div bind:this={horizontalTeamLabel} class="flex items-center justify-center gap-2 py-3" style="margin-bottom: {BASE_LABEL_GAP}px;">
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
				<div bind:this={verticalTeamLabel} class="flex flex-col items-center justify-center gap-2" style="padding-right: {BASE_LABEL_GAP}px;">
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
						<div class="col-numbers-row">
							<div class="row-number-spacer"></div>
							{#each cols as col}
								<div
									class="col-number flex items-center justify-center text-xs sm:text-sm font-bold text-white team-col-bg {col === 0 ? 'rounded-tl-lg' : ''} {col === 9 ? 'rounded-tr-lg' : ''}"
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
								<div class="row-number-container {row < 9 ? 'mb-0.5' : ''}">
									<div
										class="row-number flex items-center justify-center text-xs sm:text-sm font-bold text-white team-row-bg {row === 0 ? 'rounded-tl-lg' : ''} {row === 9 ? 'rounded-bl-lg' : ''}"
									>
										{$numbers ? $numbers.row_numbers[row] : '?'}
									</div>
								</div>
							{/each}
						</div>

						<!-- Panzoom Target: Grid Squares Only -->
						<div bind:this={gridContainer} class="grid-squares-container">
							{#each rows as row}
								<div class="grid-row">
									{#each cols as col}
										{@const square = getSquare(row, col)}
										{#if square}
											<Square
												{square}
												size={cellSize}
												rowNumber={$numbers?.row_numbers[row]}
												colNumber={$numbers?.col_numbers[col]}
												isLocked={$party?.status !== 'filling'}
												isSelected={selectedCells.has(cellKey(row, col))}
												isPressed={pressedCell?.row === row && pressedCell?.col === col}
												pressProgress={pressedCell?.row === row && pressedCell?.col === col ? pressProgress : 0}
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

		<!-- Zoom Indicator -->
		{#if showZoomIndicator && needsZoom}
			<div class="zoom-indicator">
				{currentZoom.toFixed(1)}x
			</div>
		{/if}

		<!-- Accessibility Zoom Controls -->
		{#if needsZoom}
			<div class="zoom-controls">
				<button
					class="zoom-btn"
					onclick={zoomOut}
					aria-label="Zoom out"
					disabled={currentZoom <= minZoom + ZOOM_TOLERANCE}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="11" cy="11" r="8"></circle>
						<line x1="21" y1="21" x2="16.65" y2="16.65"></line>
						<line x1="8" y1="11" x2="14" y2="11"></line>
					</svg>
				</button>
				<button
					class="zoom-btn"
					onclick={resetZoom}
					aria-label="Reset zoom"
					disabled={Math.abs(currentZoom - 1) < ZOOM_TOLERANCE}
				>
					<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
						<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
						<line x1="9" y1="3" x2="9" y2="21"></line>
						<line x1="15" y1="3" x2="15" y2="21"></line>
						<line x1="3" y1="9" x2="21" y2="9"></line>
						<line x1="3" y1="15" x2="21" y2="15"></line>
					</svg>
				</button>
				<button
					class="zoom-btn"
					onclick={zoomIn}
					aria-label="Zoom in"
					disabled={currentZoom >= 2 - ZOOM_TOLERANCE}
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

	.grid-outer-container {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0; /* Allow flex shrinking */
	}

	.sticky-column-numbers {
		position: sticky;
		top: 0;
		z-index: 20;
		background: var(--bg-primary);
		transform-origin: 0 0;
		will-change: transform; /* Optimize for frequent transform updates during pan/zoom */
	}

	.sticky-row-numbers {
		position: sticky;
		left: 0;
		z-index: 20;
		background: var(--bg-primary);
		transform-origin: 0 0;
		flex-shrink: 0;
		will-change: transform; /* Optimize for frequent transform updates during pan/zoom */
	}

	.grid-squares-container {
		flex: 1;
		min-width: fit-content;
		touch-action: none; /* Prevent browser touch gestures from interfering with panzoom */
	}

	/* Column numbers row - uses CSS variables for dynamic sizing */
	.col-numbers-row {
		display: flex;
		gap: 2px;
		margin-bottom: 2px;
	}

	.row-number-spacer {
		/* Uses CSS variable for row header width */
		width: var(--row-header-width, 32px);
		flex-shrink: 0;
	}

	.col-number {
		/* Uses CSS variables for dynamic sizing - no breakpoints */
		min-width: var(--cell-size, 44px);
		width: var(--cell-size, 44px);
		height: var(--header-height, 28px);
		flex-shrink: 0;
	}

	/* Row numbers - uses CSS variables for dynamic sizing */
	.row-number-container {
		display: flex;
	}

	.row-number {
		/* Uses CSS variables for dynamic sizing - no breakpoints */
		width: var(--row-header-width, 32px);
		min-height: var(--cell-size, 44px);
		height: var(--cell-size, 44px);
		flex-shrink: 0;
	}

	/* Grid rows - must match column layout */
	.grid-row {
		display: flex;
		gap: 2px;
		margin-bottom: 2px;
	}

	.grid-row:last-child {
		margin-bottom: 0;
	}

	.zoom-indicator {
		position: fixed;
		bottom: calc(max(1rem, env(safe-area-inset-bottom, 0px)) + 180px);
		right: max(1rem, env(safe-area-inset-right, 0px));
		padding: 0.5rem 0.75rem;
		background: rgba(26, 26, 36, 0.9);
		backdrop-filter: blur(8px);
		-webkit-backdrop-filter: blur(8px);
		border: 1px solid rgba(255, 255, 255, 0.15);
		border-radius: 8px;
		font-size: 0.875rem;
		font-weight: 600;
		color: var(--text-primary);
		z-index: 101;
		animation: fadeInOut 1.5s ease-out forwards;
	}

	@keyframes fadeInOut {
		0% { opacity: 0; transform: translateY(5px); }
		15% { opacity: 1; transform: translateY(0); }
		85% { opacity: 1; }
		100% { opacity: 0; }
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
		touch-action: manipulation; /* Prevent 300ms tap delay and double-tap-to-zoom interference */
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
</style>
