import { get } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
import type { OptimisticOperation, Square } from '$lib/types';
import { toast } from './toast';
import { userName, normalizePlayerName } from './user';
import { clientId, party, squares, pendingOperations, squareKey } from './game-state';
import { broadcast, schedulePendingTimeout } from './game-realtime';

/**
 * Optimistic claim — updates UI immediately, then confirms with server.
 * Non-blocking: returns immediately after the optimistic update.
 *
 * The full 8-step chain (also documented in CLAUDE.md):
 *   1. User action invokes this function.
 *   2. Pending op added to `pendingOperations` (keyed "row-col") — see step 1 below.
 *   3. Local `squares` store updated immediately — see step 2 below.
 *   4. Broadcast sent on the Supabase Realtime broadcast channel — see step 3 below.
 *   5. Timeout scheduled (PENDING_TIMEOUT_MS, default 10s) — see step 4 below.
 *   6. RPC fires via `.then()`, NOT `await` — non-blocking — see step 5 below.
 *      Why .then(): the function returns immediately so the UI doesn't block;
 *      changing this to `await` would defeat the optimistic UX. Do not refactor.
 *   7. On success: `postgres_changes` (transport layer) calls
 *      `applySquareUpdate` which clears the pending op + timeout.
 *   8. On failure: rollback to `originalState`, broadcast `claim_rejected`,
 *      toast the user — see the .then() callback below.
 */
export function claimSquareOptimistic(row: number, col: number): void {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return;
	if (currentParty.status !== 'filling') return;

	const key = squareKey(row, col);
	const currentSquares = get(squares);
	const existingSquare = currentSquares.find((s) => s.row_num === row && s.col_num === col);

	if (!existingSquare || existingSquare.player_name) return; // Already claimed

	const timestamp = Date.now();
	const operationId = `${clientId}-${key}-${timestamp}`;

	// 1. Create pending operation for rollback
	const operation: OptimisticOperation = {
		id: operationId,
		type: 'claim',
		row,
		col,
		timestamp,
		status: 'pending',
		originalState: {
			player_name: existingSquare.player_name,
			player_name_lower: existingSquare.player_name_lower,
			claimed_at: existingSquare.claimed_at,
		},
	};

	pendingOperations.update((ops) => {
		const newOps = new Map(ops);
		newOps.set(key, operation);
		return newOps;
	});

	// 2. Immediately update local state (optimistic)
	squares.update((current) =>
		current.map((s) =>
			s.row_num === row && s.col_num === col
				? {
						...s,
						player_name: currentUser,
						player_name_lower: normalizePlayerName(currentUser),
						claimed_at: new Date().toISOString(),
					}
				: s
		)
	);

	// 3. Broadcast intent to other clients
	broadcast(currentParty.id, {
		type: 'claim_intent',
		squareKey: key,
		playerName: currentUser,
		timestamp,
	});

	// 4. Schedule timeout cleanup
	schedulePendingTimeout(key);

	// 5. Make API call in background (non-blocking)
	const supabase = getSupabaseClient();

	supabase
		.rpc('claim_square', {
			p_party_id: currentParty.id,
			p_row: row,
			p_col: col,
			p_player_name: currentUser,
		})
		.then(({ data, error: claimError }) => {
			// claim_square returns BOOLEAN false when the square was already taken
			// (domain rejection, no error). Treat it as failure and react immediately
			// instead of waiting on a race with the real owner's postgres_changes event.
			if (claimError || data === false) {
				// Rollback on failure
				pendingOperations.update((ops) => {
					const op = ops.get(key);
					if (op && op.id === operationId) {
						const newOps = new Map(ops);
						newOps.delete(key);

						// Rollback the square state
						squares.update((current) =>
							current.map((s) =>
								s.row_num === row && s.col_num === col
									? {
											...s,
											player_name: op.originalState.player_name,
											player_name_lower: op.originalState.player_name_lower,
											claimed_at: op.originalState.claimed_at,
										}
									: s
							)
						);

						// Broadcast rejection to other clients
						broadcast(currentParty.id, {
							type: 'claim_rejected',
							squareKey: key,
							playerName: currentUser,
							timestamp,
						});

						return newOps;
					}
					return ops;
				});

				toast.error('Square already claimed');
			}
			// Success case: postgres_changes will clear the pending operation
		});
}

/**
 * Optimistic unclaim - updates UI immediately, then confirms with server
 */
export function unclaimSquareOptimistic(row: number, col: number): void {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return;
	if (currentParty.status !== 'filling') return;

	const key = squareKey(row, col);
	const currentSquares = get(squares);
	const existingSquare = currentSquares.find((s) => s.row_num === row && s.col_num === col);

	if (!existingSquare || !existingSquare.player_name) return;

	// Can only unclaim own squares
	if (existingSquare.player_name_lower !== normalizePlayerName(currentUser)) return;

	const timestamp = Date.now();
	const operationId = `${clientId}-${key}-${timestamp}`;

	// 1. Create pending operation for rollback
	const operation: OptimisticOperation = {
		id: operationId,
		type: 'unclaim',
		row,
		col,
		timestamp,
		status: 'pending',
		originalState: {
			player_name: existingSquare.player_name,
			player_name_lower: existingSquare.player_name_lower,
			claimed_at: existingSquare.claimed_at,
		},
	};

	pendingOperations.update((ops) => {
		const newOps = new Map(ops);
		newOps.set(key, operation);
		return newOps;
	});

	// 2. Immediately update local state (optimistic)
	squares.update((current) =>
		current.map((s) =>
			s.row_num === row && s.col_num === col
				? { ...s, player_name: null, player_name_lower: null, claimed_at: null }
				: s
		)
	);

	// 3. Broadcast intent to other clients
	broadcast(currentParty.id, {
		type: 'unclaim_intent',
		squareKey: key,
		playerName: currentUser,
		timestamp,
	});

	// 4. Schedule timeout cleanup
	schedulePendingTimeout(key);

	// 5. Make API call in background
	const supabase = getSupabaseClient();

	supabase
		.rpc('unclaim_square', {
			p_party_id: currentParty.id,
			p_row: row,
			p_col: col,
			p_player_name: currentUser,
		})
		.then(({ data, error: unclaimError }) => {
			// unclaim_square returns BOOLEAN false for a DOMAIN rejection (row already
			// changed / not ours — migration 029) with NO error. A false return changes
			// zero rows, so no postgres_changes event ever arrives to heal us: we MUST
			// roll back here, exactly as the error path does, or the square stays empty
			// forever on this client while the DB still shows it owned.
			if (unclaimError || data === false) {
				// Rollback on failure
				pendingOperations.update((ops) => {
					const op = ops.get(key);
					if (op && op.id === operationId) {
						const newOps = new Map(ops);
						newOps.delete(key);

						// Rollback the square state
						squares.update((current) =>
							current.map((s) =>
								s.row_num === row && s.col_num === col
									? {
											...s,
											player_name: op.originalState.player_name,
											player_name_lower: op.originalState.player_name_lower,
											claimed_at: op.originalState.claimed_at,
										}
									: s
							)
						);

						// Tell observers (who optimistically cleared this square on our
						// unclaim_intent) to restore it. Without this they'd show the square
						// empty forever, since the failed unclaim produced no DB change.
						broadcast(currentParty.id, {
							type: 'unclaim_rejected',
							squareKey: key,
							playerName: currentUser,
							timestamp,
						});

						return newOps;
					}
					return ops;
				});

				toast.error("Couldn't unclaim that square — try again.");
			}
		});
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
					originalState: {
						player_name: cell.square.player_name,
						player_name_lower: cell.square.player_name_lower,
						claimed_at: cell.square.claimed_at,
					},
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
								? {
										...s,
										player_name: operation.originalState.player_name,
										player_name_lower: operation.originalState.player_name_lower,
										claimed_at: operation.originalState.claimed_at,
									}
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
			return operation && rolledBackKeys.has(key)
				? {
						...s,
						player_name: operation.originalState.player_name,
						player_name_lower: operation.originalState.player_name_lower,
						claimed_at: operation.originalState.claimed_at,
					}
				: s;
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
