import { get } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
import type { OptimisticOperation, Square } from '$lib/types';
import { toast } from './toast';
import { userName, normalizePlayerName } from './user';
import {
	clientId,
	party,
	squares,
	squareKey,
	selectedPlayerFilter,
	restoreSelectedPlayerFilter,
} from './game-state';
import {
	pendingOperations,
	schedulePendingTimeout,
	snapshotSquare,
	withSnapshot,
	clearSquareFields,
	setPendingOp,
	rollbackPendingOpIf,
} from './game-pending';
import { broadcast, isOffline } from './game-realtime';

/**
 * Fail fast when offline instead of optimistically applying and waiting on
 * the 10s pending timeout — there's no network to reach the server over.
 * Toasts the user and returns true when the caller should bail immediately.
 */
function blockedByOffline(action: 'claim' | 'unclaim'): boolean {
	if (!get(isOffline)) return false;
	toast.error(`You're offline — reconnect to ${action} squares`);
	return true;
}

type SingleAction = 'claim' | 'unclaim';

/**
 * The per-action differences between a single-square claim and unclaim. Everything
 * else — guards, op creation, pending set, broadcast, timeout, the non-blocking RPC
 * and its rollback — is shared by runSingleOptimistic.
 */
interface SingleOptimisticSpec {
	type: SingleAction;
	rpc: 'claim_square' | 'unclaim_square';
	intent: 'claim_intent' | 'unclaim_intent';
	rejection: 'claim_rejected' | 'unclaim_rejected';
	/** Whether the square may be acted on (beyond the party/user/existence guards). */
	canAct: (existingSquare: Square, currentUser: string) => boolean;
	/** The optimistic local change applied to the square. */
	patch: (s: Square, currentUser: string) => Square;
	/**
	 * Toast copy when the RPC errors vs. when it returns BOOLEAN false. Only a
	 * BOOLEAN false is a domain rejection; an RPC error (network, server) says
	 * nothing about ownership. `rejectedToast` defaults to `errorToast`.
	 */
	errorToast: string;
	rejectedToast?: string;
}

const CLAIM_SPEC: SingleOptimisticSpec = {
	type: 'claim',
	rpc: 'claim_square',
	intent: 'claim_intent',
	rejection: 'claim_rejected',
	canAct: (existingSquare) => !existingSquare.player_name, // Already claimed otherwise
	patch: (s, currentUser) => ({
		...s,
		player_name: currentUser,
		player_name_lower: normalizePlayerName(currentUser),
		claimed_at: new Date().toISOString(),
	}),
	errorToast: "Couldn't save that claim — try again.",
	rejectedToast: 'Square already claimed',
};

const UNCLAIM_SPEC: SingleOptimisticSpec = {
	type: 'unclaim',
	rpc: 'unclaim_square',
	intent: 'unclaim_intent',
	rejection: 'unclaim_rejected',
	// Must be claimed, and can only unclaim own squares
	canAct: (existingSquare, currentUser) =>
		!!existingSquare.player_name &&
		existingSquare.player_name_lower === normalizePlayerName(currentUser),
	patch: (s) => clearSquareFields(s),
	errorToast: "Couldn't unclaim that square — try again.",
};

/**
 * Shared single-square optimistic flow — updates UI immediately, then confirms with
 * the server. Non-blocking: returns immediately after the optimistic update.
 *
 * The full 8-step chain (also documented in CLAUDE.md):
 *   1. User action invokes claimSquareOptimistic / unclaimSquareOptimistic.
 *   2. Pending op added to `pendingOperations` (keyed "row-col") (body step 1).
 *   3. Local `squares` store updated immediately (body step 2).
 *   4. Broadcast sent on the Supabase Realtime broadcast channel (body step 3).
 *   5. Timeout scheduled (PENDING_TIMEOUT_MS, default 10s) (body step 4).
 *   6. RPC fires via `.then()`, NOT `await` — non-blocking (body step 5).
 *      Why .then(): the function returns immediately so the UI doesn't block;
 *      changing this to `await` would defeat the optimistic UX. Do not refactor.
 *   7. On success: `postgres_changes` (transport layer) calls
 *      `applySquareUpdate` which clears the pending op + timeout.
 *   8. On failure: rollback to `originalState`, broadcast the rejection,
 *      toast the user — see the .then() callback below.
 */
function runSingleOptimistic(spec: SingleOptimisticSpec, row: number, col: number): void {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return;
	if (currentParty.status !== 'filling') return;

	const key = squareKey(row, col);
	const currentSquares = get(squares);
	const existingSquare = currentSquares.find((s) => s.row_num === row && s.col_num === col);

	if (!existingSquare || !spec.canAct(existingSquare, currentUser)) return;

	if (blockedByOffline(spec.type)) return;

	const timestamp = Date.now();
	const operationId = `${clientId}-${key}-${timestamp}`;

	// 1. Create pending operation for rollback
	const operation: OptimisticOperation = {
		id: operationId,
		type: spec.type,
		row,
		col,
		timestamp,
		status: 'pending',
		originalState: snapshotSquare(existingSquare),
	};

	if (spec.type === 'unclaim') {
		// Snapshot the active player filter BEFORE the optimistic clear below: clearing
		// this player's last square recomputes playerSummary and the self-clearing
		// subscription in game-state.ts nulls the filter. If the unclaim is rejected we
		// restore it from here (see the rollback path). Claim ops carry no snapshot.
		operation.filterSnapshot = get(selectedPlayerFilter);
	}

	setPendingOp(key, operation);

	// 2. Immediately update local state (optimistic)
	squares.update((current) =>
		current.map((s) => (s.row_num === row && s.col_num === col ? spec.patch(s, currentUser) : s))
	);

	// 3. Broadcast intent to other clients
	broadcast(currentParty.id, {
		type: spec.intent,
		squareKey: key,
		playerName: currentUser,
		timestamp,
	});

	// 4. Schedule timeout cleanup
	schedulePendingTimeout(key);

	// 5. Make API call in background (non-blocking)
	const supabase = getSupabaseClient();

	supabase
		.rpc(spec.rpc, {
			p_party_id: currentParty.id,
			p_row: row,
			p_col: col,
			p_player_name: currentUser,
		})
		.then(({ data, error: rpcError }) => {
			// Both RPCs return BOOLEAN false for a DOMAIN rejection (claim: square already
			// taken; unclaim: row already changed / not ours — migration 029) with NO error.
			// A false return changes zero rows: for unclaim no postgres_changes event ever
			// arrives to heal us, and for claim waiting would race the real owner's event.
			// Treat it as failure and roll back immediately, exactly as the error path does.
			if (rpcError || data === false) {
				// Rollback on failure — only if our op is still the current one
				rollbackPendingOpIf(
					key,
					(op) => op.id === operationId,
					(op) => {
						if (op.type === 'unclaim') {
							// Restore the player filter cleared by the optimistic unclaim (the
							// square is back, so the filter should be too). No-op if the user set
							// a different filter meanwhile — see restoreSelectedPlayerFilter.
							restoreSelectedPlayerFilter(op.filterSnapshot);
						}

						// Broadcast rejection to other clients. For unclaim, observers (who
						// optimistically cleared this square on our unclaim_intent) restore it;
						// without this they'd show it empty forever, since the failed unclaim
						// produced no DB change.
						broadcast(currentParty.id, {
							type: spec.rejection,
							squareKey: key,
							playerName: currentUser,
							timestamp,
						});
					}
				);

				toast.error(rpcError ? spec.errorToast : (spec.rejectedToast ?? spec.errorToast));
			}
			// Success case: postgres_changes will clear the pending operation
		});
}

/** Optimistic claim — see runSingleOptimistic for the full chain. */
export function claimSquareOptimistic(row: number, col: number): void {
	runSingleOptimistic(CLAIM_SPEC, row, col);
}

/** Optimistic unclaim — see runSingleOptimistic for the full chain. */
export function unclaimSquareOptimistic(row: number, col: number): void {
	runSingleOptimistic(UNCLAIM_SPEC, row, col);
}

/**
 * Optimistic batch claim - updates UI immediately for all cells
 */
export function claimSquaresBatchOptimistic(cells: Array<{ row: number; col: number }>): void {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser || cells.length === 0) return;
	if (currentParty.status !== 'filling') return;

	const currentSquares = get(squares);
	const timestamp = Date.now();

	// Filter to only claimable cells and keep each square's original state for rollback.
	const claimableCells = cells.flatMap((cell) => {
		const square = currentSquares.find((s) => s.row_num === cell.row && s.col_num === cell.col);
		return square && !square.player_name ? [{ ...cell, square }] : [];
	});

	if (claimableCells.length === 0) return;

	if (blockedByOffline('claim')) return;

	// 1. Create pending operations for all cells
	const operations: Array<{ key: string; operation: OptimisticOperation }> = claimableCells.map(
		(cell) => {
			const key = squareKey(cell.row, cell.col);

			return {
				key,
				operation: {
					id: `${clientId}-${key}-${timestamp}`,
					type: 'claim' as const,
					row: cell.row,
					col: cell.col,
					timestamp,
					status: 'pending' as const,
					originalState: snapshotSquare(cell.square),
				},
			};
		}
	);

	pendingOperations.update((ops) => {
		const newOps = new Map(ops);
		for (const { key, operation } of operations) {
			newOps.set(key, operation);
		}
		return newOps;
	});

	// 2. Immediately update all squares
	const cellKeys = new Set(claimableCells.map((c) => squareKey(c.row, c.col)));
	squares.update((current) =>
		current.map((s) =>
			cellKeys.has(squareKey(s.row_num, s.col_num))
				? {
						...s,
						player_name: currentUser,
						player_name_lower: normalizePlayerName(currentUser),
						claimed_at: new Date().toISOString(),
					}
				: s
		)
	);

	// 3. Broadcast intents for all cells
	for (const cell of claimableCells) {
		broadcast(currentParty.id, {
			type: 'claim_intent',
			squareKey: squareKey(cell.row, cell.col),
			playerName: currentUser,
			timestamp,
		});
	}

	// 4. Schedule timeout cleanup for each
	for (const { key } of operations) {
		schedulePendingTimeout(key);
	}

	// 5. Make batch API call
	const supabase = getSupabaseClient();

	supabase
		.rpc('claim_squares_batch', {
			p_party_id: currentParty.id,
			p_player_name: currentUser,
			p_cells: claimableCells.map(({ row, col }) => ({ row, col })),
		})
		.then(({ data, error: claimError }) => {
			if (claimError) {
				const latestOps = get(pendingOperations);
				const rollbackOperations = operations.filter(
					({ key, operation }) => latestOps.get(key)?.id === operation.id
				);
				const operationByKey = new Map(
					rollbackOperations.map(({ key, operation }) => [key, operation])
				);
				const rollbackKeys = new Set(operationByKey.keys());

				pendingOperations.update((ops) => {
					const newOps = new Map(ops);
					for (const { key, operation } of rollbackOperations) {
						if (newOps.get(key)?.id === operation.id) {
							newOps.delete(key);
						}
					}
					return newOps;
				});

				if (rollbackKeys.size > 0) {
					squares.update((current) =>
						current.map((s) => {
							const key = squareKey(s.row_num, s.col_num);
							const operation = operationByKey.get(key);
							return operation && rollbackKeys.has(key)
								? withSnapshot(s, operation.originalState)
								: s;
						})
					);
				}

				toast.error("Couldn't save those claims — try again.");
				return;
			}

			const claimed = data || 0;
			const failed = claimableCells.length - claimed;

			if (failed > 0) {
				// A short count means some cells were taken by someone else first. The RPC
				// returns only a count, so refetch to learn WHICH cells we lost and roll them
				// back immediately instead of racing each winner's postgres_changes event.
				void reconcileShortBatchClaim(currentParty.id, currentUser, operations);
				toast.error(`${failed} square${failed > 1 ? 's were' : ' was'} already claimed`);
			}

			if (claimed > 0) {
				toast.success(`Claimed ${claimed} square${claimed > 1 ? 's' : ''}`);
			}
		});
}

/**
 * After a batch claim comes back short (claimed < requested), the RPC reports only HOW
 * MANY cells we lost, not WHICH. Refetch the party's squares, find the cells the DB shows
 * are no longer ours, roll those back on this client, and tell observers to do the same —
 * rather than depending on a race with each winner's postgres_changes event to heal us.
 * Best-effort: if the refetch fails, the per-cell 10s timeout + postgres_changes remain as
 * backstops, exactly as before.
 */
async function reconcileShortBatchClaim(
	partyId: string,
	currentUser: string,
	operations: Array<{ key: string; operation: OptimisticOperation }>
): Promise<void> {
	const supabase = getSupabaseClient();
	const { data, error } = await supabase.from('squares').select('*').eq('party_id', partyId);
	if (error || !data) return;

	const rows = data as Square[];
	const normalizedUser = normalizePlayerName(currentUser);

	// A cell was lost unless the DB now shows it owned by us.
	const candidates = operations.filter(({ operation }) => {
		const dbSquare = rows.find((s) => s.row_num === operation.row && s.col_num === operation.col);
		return !dbSquare || dbSquare.player_name_lower !== normalizedUser;
	});

	if (candidates.length === 0) return;

	// Roll back only cells whose optimistic op is still the current pending op —
	// postgres_changes may already have resolved some of them.
	const rolledBack: Array<{ key: string; operation: OptimisticOperation }> = [];
	pendingOperations.update((ops) => {
		const newOps = new Map(ops);
		for (const { key, operation } of candidates) {
			if (newOps.get(key)?.id === operation.id) {
				newOps.delete(key);
				rolledBack.push({ key, operation });
			}
		}
		return newOps;
	});

	if (rolledBack.length === 0) return;

	const operationByKey = new Map(rolledBack.map(({ key, operation }) => [key, operation]));
	const rolledBackKeys = new Set(operationByKey.keys());

	squares.update((current) =>
		current.map((s) => {
			const key = squareKey(s.row_num, s.col_num);
			const operation = operationByKey.get(key);
			if (!operation || !rolledBackKeys.has(key)) return s;
			// We just fetched the DB truth for these lost cells — apply the fetched owner
			// rather than blanking to originalState (EMPTY). Writing the real owner means
			// the cell is correct immediately and STAYS correct even if the winner's
			// postgres_changes event is never delivered (a documented realtime-gap concern);
			// blanking would leave it wrongly empty until reload in that case. Fall back to
			// originalState only when the DB has no row for this cell at all.
			const dbSquare = rows.find((row) => row.row_num === s.row_num && row.col_num === s.col_num);
			return withSnapshot(s, dbSquare ? snapshotSquare(dbSquare) : operation.originalState);
		})
	);

	for (const { key } of rolledBack) {
		broadcast(partyId, {
			type: 'claim_rejected',
			squareKey: key,
			playerName: currentUser,
			timestamp: Date.now(),
		});
	}
}
