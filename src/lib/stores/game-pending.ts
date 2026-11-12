// Pending optimistic operations: one per square while a claim or unclaim is in
// flight, either ours (origin 'local') or a preview of another tab's intent
// (origin 'remote'). This module owns an op's whole life: creation, its 10s
// timeout, and every way it ends (confirmed by postgres_changes, rolled back).
//
// Dependency direction (no cycles): game-state ← game-pending ← game-realtime ←
// game-optimistic. That is why applySquareUpdate, the postgres_changes handler
// that confirms ops, lives here rather than in game-state.

import { writable } from 'svelte/store';
import type { OptimisticOperation, Square } from '$lib/types';
import { toast } from './toast';
import { clientId, squares } from './game-state';
import { squareKey } from '$lib/utils/squareKey';

export type SquareSnapshot = Pick<Square, 'player_name' | 'player_name_lower' | 'claimed_at'>;

export const pendingOperations = writable<Map<string, OptimisticOperation>>(new Map());

const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

const PENDING_TIMEOUT_MS = 10000;

/** The ownership fields of a square, so an optimistic change can be undone. */
function snapshotSquare(sq: SquareSnapshot): SquareSnapshot {
	return {
		player_name: sq.player_name,
		player_name_lower: sq.player_name_lower,
		claimed_at: sq.claimed_at,
	};
}

/** Pure: a copy of `s` with the ownership fields replaced by `snapshot`. */
function withSnapshot(s: Square, snapshot: SquareSnapshot): Square {
	return { ...s, ...snapshotSquare(snapshot) };
}

/** Pure: a copy of `s` with no owner. */
export function clearSquareFields(s: Square): Square {
	return { ...s, player_name: null, player_name_lower: null, claimed_at: null };
}

/** A new op for a square about to change. Remote ops are keyed by the tab that sent them. */
export function newPendingOp(
	type: OptimisticOperation['type'],
	square: Square,
	timestamp: number,
	origin: { remoteClientId: string } | 'local' = 'local'
): OptimisticOperation {
	return {
		type,
		row: square.row_num,
		col: square.col_num,
		timestamp,
		originalState: snapshotSquare(square),
		clientId: origin === 'local' ? clientId : origin.remoteClientId,
		origin: origin === 'local' ? 'local' : 'remote',
	};
}

/** Whether `op` is the same in-flight operation as `other` (not a later one on that square). */
export function isSameOp(op: OptimisticOperation, other: OptimisticOperation): boolean {
	return (
		op.clientId === other.clientId && op.timestamp === other.timestamp && op.type === other.type
	);
}

/** Record ops and start their timeouts. */
export function addPendingOps(ops: OptimisticOperation[]): void {
	pendingOperations.update((current) => {
		const next = new Map(current);
		for (const op of ops) next.set(squareKey(op.row, op.col), op);
		return next;
	});
	for (const op of ops) scheduleTimeout(op);
}

function clearTimer(key: string): void {
	const timer = pendingTimeouts.get(key);
	if (timer) {
		clearTimeout(timer);
		pendingTimeouts.delete(key);
	}
}

/**
 * Roll back the pending op at `key` if `shouldRollback(op)` holds: the square
 * goes back to `restoreTo` (default: how it was before the op) and the op and
 * its timer are dropped.
 *
 * The check, the delete and the square restore run inside ONE
 * pendingOperations.update, so a concurrent writer cannot slip between check
 * and delete, and squares subscribers see the restored square before
 * pendingOperations subscribers see the op gone. Returns the rolled-back op.
 */
export function rollbackPendingOpIf(
	key: string,
	shouldRollback: (op: OptimisticOperation) => boolean,
	restoreTo?: SquareSnapshot
): OptimisticOperation | null {
	let rolledBack: OptimisticOperation | null = null;
	pendingOperations.update((ops) => {
		const op = ops.get(key);
		if (!op || !shouldRollback(op)) return ops;
		const next = new Map(ops);
		next.delete(key);
		const snapshot = restoreTo ?? op.originalState;
		squares.update((current) =>
			current.map((s) =>
				s.row_num === op.row && s.col_num === op.col ? withSnapshot(s, snapshot) : s
			)
		);
		rolledBack = op;
		return next;
	});
	if (rolledBack) clearTimer(key);
	return rolledBack;
}

const TIMEOUT_COPY: Record<OptimisticOperation['type'], string> = {
	claim: "We couldn't reach the server. Your claim wasn't saved — try again.",
	unclaim: "We couldn't reach the server. That square is still yours — try again.",
};

function scheduleTimeout(op: OptimisticOperation): void {
	const key = squareKey(op.row, op.col);
	clearTimer(key);
	pendingTimeouts.set(
		key,
		setTimeout(() => {
			pendingTimeouts.delete(key);
			const rolledBack = rollbackPendingOpIf(key, (current) => isSameOp(current, op));
			// A remote op is a preview of someone else's action; its timeout heals silently.
			if (rolledBack?.origin === 'local') toast.error(TIMEOUT_COPY[rolledBack.type]);
		}, PENDING_TIMEOUT_MS)
	);
}

/** Apply an UPDATE on the squares table. The DB is the source of truth, so any pending op ends. */
export function applySquareUpdate(newSquare: Square): void {
	const key = squareKey(newSquare.row_num, newSquare.col_num);
	clearTimer(key);
	pendingOperations.update((ops) => {
		if (!ops.has(key)) return ops;
		const next = new Map(ops);
		next.delete(key);
		return next;
	});
	squares.update((current) => current.map((s) => (s.id === newSquare.id ? newSquare : s)));
}

/** Drop every pending op and timer (leaving a party). */
export function clearPendingOps(): void {
	for (const timer of pendingTimeouts.values()) clearTimeout(timer);
	pendingTimeouts.clear();
	pendingOperations.set(new Map());
}
