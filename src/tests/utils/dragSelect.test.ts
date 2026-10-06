import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DragSelect } from '$lib/utils/dragSelect.svelte';

function pointer(pointerType: string, button = 0): PointerEvent {
	return { pointerType, button } as PointerEvent;
}

describe('DragSelect', () => {
	let canInteract: ReturnType<typeof vi.fn<() => boolean>>;
	let onCellClick: ReturnType<typeof vi.fn<(row: number, col: number) => void>>;
	let onBatch: ReturnType<typeof vi.fn<(cells: { row: number; col: number }[]) => void>>;
	let blocked: Set<string>;
	let drag: DragSelect;

	beforeEach(() => {
		canInteract = vi.fn(() => true);
		onCellClick = vi.fn();
		onBatch = vi.fn();
		blocked = new Set();
		drag = new DragSelect({
			canInteract,
			canSelectCell: (r, c) => !blocked.has(`${r}-${c}`),
			onCellClick,
			onBatch,
		});
	});

	it('ignores pointerdown when the user cannot interact', () => {
		canInteract.mockReturnValue(false);
		drag.pointerDown(0, 0, pointer('mouse'));
		expect(drag.isDragging).toBe(false);
		drag.pointerUp(0, 0);
		expect(onCellClick).not.toHaveBeenCalled();
	});

	it('ignores non-primary buttons', () => {
		drag.pointerDown(0, 0, pointer('mouse', 2));
		expect(drag.isDragging).toBe(false);
	});

	it('mouse drag selects the rectangle of selectable cells and batches on release', () => {
		blocked.add('1-1');
		drag.pointerDown(0, 0, pointer('mouse'));
		expect(drag.isDragging).toBe(true);
		expect([...drag.selectedCells]).toEqual(['0-0']);

		drag.pointerEnter(1, 2);
		expect(new Set(drag.selectedCells)).toEqual(new Set(['0-0', '0-1', '0-2', '1-0', '1-2']));

		drag.pointerUp(1, 2);
		expect(drag.isDragging).toBe(false);
		expect(drag.selectedCells.size).toBe(0);
		expect(onBatch).toHaveBeenCalledTimes(1);
		expect(onBatch.mock.calls[0][0]).toHaveLength(5);
		expect(onBatch.mock.calls[0][0]).toContainEqual({ row: 1, col: 2 });
		expect(onCellClick).not.toHaveBeenCalled();
	});

	it('shrinks the selection when the pointer moves back', () => {
		drag.pointerDown(0, 0, pointer('mouse'));
		drag.pointerEnter(2, 2);
		expect(drag.selectedCells.size).toBe(9);
		drag.pointerEnter(0, 1);
		expect(new Set(drag.selectedCells)).toEqual(new Set(['0-0', '0-1']));
	});

	it('a mouse press on a non-selectable cell is a plain click, not a drag', () => {
		blocked.add('4-4');
		drag.pointerDown(4, 4, pointer('mouse'));
		expect(drag.isDragging).toBe(false);
		drag.pointerUp(4, 4);
		expect(onCellClick).toHaveBeenCalledWith(4, 4);
		expect(onBatch).not.toHaveBeenCalled();
	});

	it('a plain click released over a different cell does nothing', () => {
		blocked.add('4-4');
		drag.pointerDown(4, 4, pointer('mouse'));
		drag.pointerUp(4, 5);
		expect(onCellClick).not.toHaveBeenCalled();
	});

	it('touch taps claim on the same cell and never drag', () => {
		drag.pointerDown(2, 3, pointer('touch'));
		expect(drag.isDragging).toBe(false);
		drag.pointerEnter(2, 4);
		expect(drag.selectedCells.size).toBe(0);
		drag.pointerUp(2, 3);
		expect(onCellClick).toHaveBeenCalledWith(2, 3);
		expect(onBatch).not.toHaveBeenCalled();
	});

	it('touch released on a different cell does not click', () => {
		drag.pointerDown(2, 3, pointer('touch'));
		drag.pointerUp(2, 4);
		expect(onCellClick).not.toHaveBeenCalled();
	});

	it('global pointerup outside the grid commits the drag', () => {
		drag.pointerDown(0, 0, pointer('mouse'));
		drag.pointerEnter(0, 2);
		drag.globalPointerUp();
		expect(onBatch).toHaveBeenCalledWith([
			{ row: 0, col: 0 },
			{ row: 0, col: 1 },
			{ row: 0, col: 2 },
		]);
		expect(drag.isDragging).toBe(false);
	});

	it('pointercancel discards the drag without batching', () => {
		drag.pointerDown(0, 0, pointer('mouse'));
		drag.pointerEnter(0, 2);
		drag.globalPointerCancel();
		expect(drag.isDragging).toBe(false);
		expect(drag.selectedCells.size).toBe(0);
		expect(onBatch).not.toHaveBeenCalled();
	});
});
