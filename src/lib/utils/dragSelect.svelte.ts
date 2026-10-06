import { SvelteSet } from 'svelte/reactivity';
import { cellKey } from './gridLayout';

export interface CellRef {
	row: number;
	col: number;
}

export interface DragSelectOptions {
	/** Whether the user may interact with the grid at all (named + party filling). */
	canInteract: () => boolean;
	/** Whether a cell can be added to a drag selection (unclaimed). */
	canSelectCell: (row: number, col: number) => boolean;
	/** A plain click/tap on a cell (claim or unclaim). */
	onCellClick: (row: number, col: number) => void;
	/** A completed drag with at least one selected cell. */
	onBatch: (cells: CellRef[]) => void;
}

/**
 * Pointer drag-select state machine for the squares grid.
 *
 * Square cells receive per-cell pointer props, so this is a controller rather
 * than a container-level Svelte action: per-cell `pointerenter` does not
 * bubble, and delegating would change the event semantics.
 *
 * Semantics: mouse/pen starts a drag immediately on a selectable cell; touch
 * never drags (tap-only: pointerdown and pointerup on the same cell).
 */
export class DragSelect {
	isDragging = $state(false);
	readonly selectedCells = new SvelteSet<string>();
	#dragStartCell: CellRef | null = null;
	// Pointer start for tap / click detection
	#pointerStartCell: CellRef | null = null;
	#isPointerTouch = false;
	readonly #opts: DragSelectOptions;

	constructor(opts: DragSelectOptions) {
		this.#opts = opts;
	}

	pointerDown(row: number, col: number, e: PointerEvent) {
		if (!this.#opts.canInteract()) return;
		if (e.button !== 0) return;

		this.#pointerStartCell = { row, col };
		this.#isPointerTouch = e.pointerType === 'touch';

		// Mouse/pen - immediate drag selection (not touch)
		if (!this.#isPointerTouch && this.#opts.canSelectCell(row, col)) {
			this.isDragging = true;
			this.#dragStartCell = { row, col };
			this.selectedCells.clear();
			this.selectedCells.add(cellKey(row, col));
		}
	}

	pointerEnter(row: number, col: number) {
		if (!this.#isPointerTouch && this.isDragging && this.#dragStartCell) {
			this.#extend(row, col);
		}
	}

	pointerUp(row: number, col: number) {
		const start = this.#pointerStartCell;
		const sameCell = start !== null && start.row === row && start.col === col;
		if (this.#isPointerTouch) {
			// Touch - single tap to claim/unclaim
			if (sameCell) this.#opts.onCellClick(row, col);
		} else if (this.isDragging) {
			// Mouse/pen - end drag selection
			this.#end();
		} else if (sameCell) {
			// A plain click (e.g. unclaiming an owned square, which never enters
			// drag because canSelectCell excludes it)
			this.#opts.onCellClick(row, col);
		}
		this.#pointerStartCell = null;
	}

	globalPointerUp() {
		if (this.isDragging) this.#end();
		this.#pointerStartCell = null;
	}

	globalPointerCancel() {
		this.isDragging = false;
		this.#dragStartCell = null;
		this.selectedCells.clear();
		this.#pointerStartCell = null;
	}

	#extend(row: number, col: number) {
		const start = this.#dragStartCell;
		if (!start) return;

		const minRow = Math.min(start.row, row);
		const maxRow = Math.max(start.row, row);
		const minCol = Math.min(start.col, col);
		const maxCol = Math.max(start.col, col);

		this.selectedCells.clear();
		for (let r = minRow; r <= maxRow; r++) {
			for (let c = minCol; c <= maxCol; c++) {
				if (this.#opts.canSelectCell(r, c)) {
					this.selectedCells.add(cellKey(r, c));
				}
			}
		}
	}

	#end() {
		if (!this.isDragging) return;

		this.isDragging = false;
		this.#dragStartCell = null;

		if (this.selectedCells.size > 0) {
			const cells = Array.from(this.selectedCells).map((key) => {
				const [row, col] = key.split('-').map(Number);
				return { row, col };
			});
			this.selectedCells.clear();
			this.#opts.onBatch(cells);
		}
	}
}
