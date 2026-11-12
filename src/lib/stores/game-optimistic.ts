import { canActOnGrid } from '$lib/partyStatus';
import { get } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
import type { OptimisticOperation, Square } from '$lib/types';
import { toast } from './toast';
import { userName } from './user';
import { normalizePlayerName } from '$lib/utils/playerName';
import { party, squares } from './game-state';
import { squareKey } from '$lib/utils/squareKey';
import {
	addPendingOps,
	clearSquareFields,
	isSameOp,
	newPendingOp,
	rollbackPendingOpIf,
	type SquareSnapshot,
} from './game-pending';
import { broadcast } from './game-realtime';
import { isOffline } from './connectivity';

/**
 * Optimistic claim and unclaim. Every action runs the same chain (also in
 * CLAUDE.md):
 *   1. Pending ops recorded (keyed "row-col"), each with a 10s timeout.
 *   2. Local `squares` updated immediately.
 *   3. Intent broadcast to other tabs.
 *   4. RPC fired with `.then()`, NOT `await`: the action returns at once so the
 *      UI never waits on the network. Do not change this to `await`.
 *   5. Success: postgres_changes → applySquareUpdate confirms each op.
 *   6. Refusal or error: the op rolls back, other tabs are told, the user sees
 *      a toast.
 */

type Cell = { row: number; col: number };

/** The party, user and squares for an action, or null when it is not allowed now. */
function actionContext(action: 'claim' | 'unclaim') {
	const currentParty = get(party);
	const currentUser = get(userName);
	if (!currentParty || !currentUser || !canActOnGrid(currentParty.status, currentUser)) return null;
	// No network to reach the server over: say so now rather than after the 10s timeout.
	if (get(isOffline)) {
		toast.error(`You're offline — reconnect to ${action} squares`);
		return null;
	}
	return { partyId: currentParty.id, user: currentUser, squares: get(squares) };
}

function findSquare(all: Square[], cell: Cell): Square | undefined {
	return all.find((s) => s.row_num === cell.row && s.col_num === cell.col);
}

/** Steps 1–3: record ops, apply `patch` locally, broadcast `intent`. */
function begin(
	ops: OptimisticOperation[],
	patch: (s: Square) => Square,
	intent: 'claim_intent' | 'unclaim_intent',
	user: string
): void {
	addPendingOps(ops);
	const keys = new Set(ops.map((op) => squareKey(op.row, op.col)));
	squares.update((current) =>
		current.map((s) => (keys.has(squareKey(s.row_num, s.col_num)) ? patch(s) : s))
	);
	for (const op of ops) {
		broadcast({
			type: intent,
			squareKey: squareKey(op.row, op.col),
			playerName: user,
			timestamp: op.timestamp,
		});
	}
}

/** Step 6 for one op: roll it back (if still current) and tell other tabs. */
function reject(
	op: OptimisticOperation,
	rejection: 'claim_rejected' | 'unclaim_rejected',
	user: string,
	restoreTo?: SquareSnapshot
): boolean {
	const key = squareKey(op.row, op.col);
	if (!rollbackPendingOpIf(key, (current) => isSameOp(current, op), restoreTo)) return false;
	broadcast({ type: rejection, squareKey: key, playerName: user, timestamp: op.timestamp });
	return true;
}

type ClaimResult =
	| { ok: true; claimed: Cell[]; taken: (Cell & { player_name: string | null })[] }
	| { ok: false; error: string };

function isClaimResult(data: unknown): data is ClaimResult {
	return typeof data === 'object' && data !== null && typeof (data as ClaimResult).ok === 'boolean';
}

function plural(n: number, one: string, many: string): string {
	return `${n} ${n === 1 ? one : many}`;
}

/** Claim any set of empty cells; a tap is a set of one. */
function claimCells(cells: Cell[]): void {
	const ctx = actionContext('claim');
	if (!ctx || cells.length === 0) return;

	const timestamp = Date.now();
	const ops = cells.flatMap((cell) => {
		const square = findSquare(ctx.squares, cell);
		return square && !square.player_name ? [newPendingOp('claim', square, timestamp)] : [];
	});
	if (ops.length === 0) return;

	const single = ops.length === 1;
	begin(
		ops,
		(s) => ({
			...s,
			player_name: ctx.user,
			player_name_lower: normalizePlayerName(ctx.user),
			claimed_at: new Date(timestamp).toISOString(),
		}),
		'claim_intent',
		ctx.user
	);

	getSupabaseClient()
		.rpc('claim_squares', {
			p_party_id: ctx.partyId,
			p_player_name: ctx.user,
			p_cells: ops.map((op) => ({ row: op.row, col: op.col })),
		})
		.then(({ data, error }) => {
			if (error || !isClaimResult(data) || !data.ok) {
				for (const op of ops) reject(op, 'claim_rejected', ctx.user);
				const locked = isClaimResult(data) && !data.ok && data.error === 'wrong_status';
				toast.error(
					locked
						? 'The grid is locked — squares can no longer be claimed.'
						: single
							? "Couldn't save that claim — try again."
							: "Couldn't save those claims — try again."
				);
				return;
			}

			// Cells someone else got first: show their owner now rather than waiting
			// for their postgres_changes event.
			for (const cell of data.taken) {
				const op = ops.find((o) => o.row === cell.row && o.col === cell.col);
				const owner = cell.player_name;
				const restoreTo = owner
					? { player_name: owner, player_name_lower: normalizePlayerName(owner), claimed_at: null }
					: undefined;
				// No-op when the winner's postgres_changes event already replaced our op.
				if (op) reject(op, 'claim_rejected', ctx.user, restoreTo);
			}
			const lost = data.taken.length;

			if (single) {
				if (lost) toast.error('Square already claimed');
				return;
			}
			if (lost) toast.error(`${plural(lost, 'square was', 'squares were')} already claimed`);
			if (data.claimed.length)
				toast.success(`Claimed ${plural(data.claimed.length, 'square', 'squares')}`);
		});
}

export function claimSquareOptimistic(row: number, col: number): void {
	claimCells([{ row, col }]);
}

export function claimSquaresBatchOptimistic(cells: Cell[]): void {
	claimCells(cells);
}

export function unclaimSquareOptimistic(row: number, col: number): void {
	const ctx = actionContext('unclaim');
	if (!ctx) return;

	const square = findSquare(ctx.squares, { row, col });
	if (!square?.player_name || square.player_name_lower !== normalizePlayerName(ctx.user)) return;

	const op = newPendingOp('unclaim', square, Date.now());
	begin([op], clearSquareFields, 'unclaim_intent', ctx.user);

	getSupabaseClient()
		.rpc('unclaim_square', {
			p_party_id: ctx.partyId,
			p_row: row,
			p_col: col,
			p_player_name: ctx.user,
		})
		.then(({ data, error }) => {
			// FALSE means zero rows changed (not ours, or already changed): no
			// postgres_changes event will heal us, so roll back now (migration 029).
			if (!error && data !== false) return;
			reject(op, 'unclaim_rejected', ctx.user);
			toast.error("Couldn't unclaim that square — try again.");
		});
}
