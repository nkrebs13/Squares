import { get } from 'svelte/store';
import { getSupabaseClient } from '$lib/supabase';
import type { OptimisticOperation } from '$lib/types';
import { toast } from './toast';
import { userName, normalizePlayerName } from './user';
import { clientId, party, squares, pendingOperations, squareKey } from './game-state';
import { broadcast, schedulePendingTimeout } from './game-realtime';

/**
 * Optimistic claim - updates UI immediately, then confirms with server
 * Non-blocking: returns immediately after optimistic update
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
		.then(({ error: claimError }) => {
			if (claimError) {
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
		.then(({ error: unclaimError }) => {
			if (unclaimError) {
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

						return newOps;
					}
					return ops;
				});

				toast.error('Failed to unclaim square');
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

	// Filter to only claimable cells
	const claimableCells = cells.filter((cell) => {
		const square = currentSquares.find((s) => s.row_num === cell.row && s.col_num === cell.col);
		return square && !square.player_name;
	});

	if (claimableCells.length === 0) return;

	// 1. Create pending operations for all cells
	const operations: Array<{ key: string; operation: OptimisticOperation }> = claimableCells.map(
		(cell) => {
			const key = squareKey(cell.row, cell.col);
			// Square is guaranteed to exist — claimableCells is filtered from currentSquares
			// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
			const existingSquare = currentSquares.find(
				(s) => s.row_num === cell.row && s.col_num === cell.col
			)!;

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
						player_name: existingSquare.player_name,
						player_name_lower: existingSquare.player_name_lower,
						claimed_at: existingSquare.claimed_at,
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
			p_cells: claimableCells,
		})
		.then(({ data, error: claimError }) => {
			if (claimError) {
				// Complete failure - show error
				toast.error('Failed to claim squares - please try again');
				return;
			}

			const claimed = data || 0;
			const failed = claimableCells.length - claimed;

			if (failed > 0) {
				// Some claims failed - postgres_changes will handle reconciliation
				toast.error(`${failed} square${failed > 1 ? 's were' : ' was'} already claimed`);
			}

			if (claimed > 0) {
				toast.success(`Claimed ${claimed} square${claimed > 1 ? 's' : ''}`);
			}
		});
}

// Keep the original functions for backward compatibility
export async function claimSquare(row: number, col: number): Promise<boolean> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return false;
	if (currentParty.status !== 'filling') return false;

	const supabase = getSupabaseClient();

	const { error: claimError } = await supabase.rpc('claim_square', {
		p_party_id: currentParty.id,
		p_row: row,
		p_col: col,
		p_player_name: currentUser,
	});

	if (claimError) {
		toast.error('Failed to claim square');
		return false;
	}

	return true;
}

export async function claimSquaresBatch(
	cells: Array<{ row: number; col: number }>
): Promise<number> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser || cells.length === 0) return 0;
	if (currentParty.status !== 'filling') return 0;

	const supabase = getSupabaseClient();

	const { data, error: claimError } = await supabase.rpc('claim_squares_batch', {
		p_party_id: currentParty.id,
		p_player_name: currentUser,
		p_cells: cells,
	});

	if (claimError) {
		toast.error('Failed to claim squares');
		return 0;
	}

	const claimed = data || 0;
	if (claimed > 0) {
		toast.success(`Claimed ${claimed} square${claimed > 1 ? 's' : ''}`);
	}

	return claimed;
}

export async function unclaimSquare(row: number, col: number): Promise<boolean> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser) return false;
	if (currentParty.status !== 'filling') return false;

	const supabase = getSupabaseClient();

	const { error: unclaimError } = await supabase.rpc('unclaim_square', {
		p_party_id: currentParty.id,
		p_row: row,
		p_col: col,
		p_player_name: currentUser,
	});

	return !unclaimError;
}
