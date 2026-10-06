// Pending optimistic-operation state + the helpers every optimistic / rollback
// path shares (local claim/unclaim/batch in game-optimistic.ts, remote previews
// and rejections in game-realtime.ts, the per-op timeout below).
//
// Dependency direction (no cycles): game-state ← game-pending ← game-realtime ←
// game-optimistic. This module may import from game-state but never from
// game-realtime or game-optimistic, and game-state never imports from here.
// That is why applySquareUpdate — the one postgres_changes handler that clears
// pending state — lives here rather than in game-state.

import { writable } from 'svelte/store';
import type { OptimisticOperation, Square } from '$lib/types';
import { toast } from './toast';
import { squares, squareKey, restoreSelectedPlayerFilter } from './game-state';

type SquareSnapshot = Pick<Square, 'player_name' | 'player_name_lower' | 'claimed_at'>;

// Track pending optimistic operations
export const pendingOperations = writable<Map<string, OptimisticOperation>>(new Map());

// Track timeout IDs for cleanup
export const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Timeout for pending operations (10 seconds)
export const PENDING_TIMEOUT_MS = 10000;

/** Capture the ownership fields of a square so an optimistic change can be rolled back. */
export function snapshotSquare(sq: SquareSnapshot): SquareSnapshot {
	return {
		player_name: sq.player_name,
		player_name_lower: sq.player_name_lower,
		claimed_at: sq.claimed_at,
	};
}

/** Pure: a copy of `s` with the ownership fields replaced by `snapshot`. */
export function withSnapshot(s: Square, snapshot: SquareSnapshot): Square {
	return {
		...s,
		player_name: snapshot.player_name,
		player_name_lower: snapshot.player_name_lower,
		claimed_at: snapshot.claimed_at,
	};
}

/** Pure: a copy of `s` with no owner. */
export function clearSquareFields(s: Square): Square {
	return { ...s, player_name: null, player_name_lower: null, claimed_at: null };
}

/** Restore one square's ownership fields to a previously captured snapshot. */
function restoreSquare(row: number, col: number, originalState: SquareSnapshot): void {
	squares.update((current) =>
		current.map((s) =>
			s.row_num === row && s.col_num === col ? withSnapshot(s, originalState) : s
		)
	);
}

export function setPendingOp(key: string, op: OptimisticOperation): void {
	pendingOperations.update((ops) => {
		const newOps = new Map(ops);
		newOps.set(key, op);
		return newOps;
	});
}

function deletePendingOp(key: string): void {
	pendingOperations.update((ops) => {
		const newOps = new Map(ops);
		newOps.delete(key);
		return newOps;
	});
}

/**
 * Atomically roll back the pending op at `key` if `shouldRollback(op)` holds.
 *
 * The check, the delete, the square restore and `onRollback` all run inside ONE
 * pendingOperations.update callback, so a concurrent writer can't slip in between
 * the check and the delete (a get()+delete split would reintroduce that race), and
 * `squares` subscribers see the restored square before `pendingOperations`
 * subscribers see the op removed — the same order as the hand-written blocks this
 * replaced. The squares write (and any broadcast in `onRollback`) is a nested
 * side effect inside the updater on purpose; do not hoist or reorder it.
 */
export function rollbackPendingOpIf(
	key: string,
	shouldRollback: (op: OptimisticOperation) => boolean,
	onRollback?: (op: OptimisticOperation) => void
): void {
	pendingOperations.update((ops) => {
		const op = ops.get(key);
		if (!op || !shouldRollback(op)) return ops;
		const newOps = new Map(ops);
		newOps.delete(key);
		restoreSquare(op.row, op.col, op.originalState);
		onRollback?.(op);
		return newOps;
	});
}

// Schedule timeout cleanup for pending operations
export function schedulePendingTimeout(key: string) {
	// Clear any existing timeout for this key
	const existingTimeout = pendingTimeouts.get(key);
	if (existingTimeout) {
		clearTimeout(existingTimeout);
	}

	const timeoutId = setTimeout(() => {
		pendingTimeouts.delete(key);
		// Operation timed out - rollback
		rollbackPendingOpIf(
			key,
			(op) => op.status === 'pending',
			(op) => {
				// A rolled-back unclaim restores the square, so restore any filter the
				// optimistic clear nulled too (no-op for claim ops / unchanged filters).
				if (op.type === 'unclaim') {
					restoreSelectedPlayerFilter(op.filterSnapshot);
				}

				// Only alert the user about THEIR OWN failed operation. Remote ops
				// (id "remote-<clientId>-<key>") are mirrors of another client's action;
				// their timeout is a silent self-heal, not something this user did.
				if (!op.id.startsWith('remote-')) {
					toast.error("We couldn't reach the server. Your claim wasn't saved — try again.");
				}
			}
		);
	}, PENDING_TIMEOUT_MS);

	pendingTimeouts.set(key, timeoutId);
}

/** Apply an UPDATE on the squares table (single row by id). */
export function applySquareUpdate(newSquare: Square): void {
	const key = squareKey(newSquare.row_num, newSquare.col_num);
	// DB is source of truth — clear any pending optimistic op + timeout for this square
	const existingTimeout = pendingTimeouts.get(key);
	if (existingTimeout) {
		clearTimeout(existingTimeout);
		pendingTimeouts.delete(key);
	}
	deletePendingOp(key);
	squares.update((current) => current.map((s) => (s.id === newSquare.id ? newSquare : s)));
}
