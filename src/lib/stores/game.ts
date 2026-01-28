import { writable, derived, get } from 'svelte/store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '$lib/supabase';
import type { Party, Square, Numbers, Scores, Winner, GridState, OptimisticOperation, BroadcastMessage } from '$lib/types';
import { theme } from './theme';
import { userName, normalizePlayerName } from './user';
import { toast } from './toast';

// Unique client ID per browser tab (for broadcast deduplication)
const clientId = typeof crypto !== 'undefined' ? crypto.randomUUID() : Math.random().toString(36).slice(2);

// Core state stores
export const party = writable<Party | null>(null);
export const squares = writable<Square[]>([]);
export const numbers = writable<Numbers | null>(null);
export const scores = writable<Scores | null>(null);
export const winners = writable<Winner[]>([]);
export const isLoading = writable(true);
export const error = writable<string | null>(null);

// Derived stores
export const gridState = derived(
	[party, squares, numbers, scores, winners],
	([$party, $squares, $numbers, $scores, $winners]) => {
		if (!$party) return null;
		return {
			party: $party,
			squares: $squares,
			numbers: $numbers,
			scores: $scores,
			winners: $winners
		} as GridState;
	}
);

export const filledCount = derived(squares, ($squares) =>
	$squares.filter((s) => s.player_name !== null).length
);

export const isGridFull = derived(filledCount, ($count) => $count === 100);

export const mySquares = derived([squares, userName], ([$squares, $name]) => {
	if (!$name) return [];
	const normalized = normalizePlayerName($name);
	return $squares.filter((s) => s.player_name_lower === normalized);
});

export const mySquareCount = derived(mySquares, ($mySquares) => $mySquares.length);

export const amountOwed = derived([mySquareCount, party], ([$count, $party]) => {
	if (!$party) return 0;
	return $count * $party.square_price;
});

// Player summary for legend display
export interface PlayerSummary {
	name: string;
	normalizedName: string;
	count: number;
}

export const playerSummary = derived(squares, ($squares) => {
	const playerMap = new Map<string, PlayerSummary>();

	for (const square of $squares) {
		if (square.player_name && square.player_name_lower) {
			if (!playerMap.has(square.player_name_lower)) {
				playerMap.set(square.player_name_lower, {
					name: square.player_name,
					normalizedName: square.player_name_lower,
					count: 0
				});
			}
			playerMap.get(square.player_name_lower)!.count++;
		}
	}

	// Sort by count descending
	return Array.from(playerMap.values()).sort((a, b) => b.count - a.count);
});

export const availableCount = derived(squares, ($squares) =>
	$squares.filter((s) => s.player_name === null).length
);

// Channel management
let channel: RealtimeChannel | null = null;
let broadcastChannel: RealtimeChannel | null = null;

// Track pending optimistic operations
export const pendingOperations = writable<Map<string, OptimisticOperation>>(new Map());

// Track timeout IDs for cleanup
const pendingTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

// Timeout for pending operations (10 seconds)
const PENDING_TIMEOUT_MS = 10000;

// Helper to create square key
function squareKey(row: number, col: number): string {
	return `${row}-${col}`;
}

// Helper to check if an operation is from this client
function isOwnBroadcast(message: BroadcastMessage): boolean {
	return message.clientId === clientId;
}

export async function loadParty(code: string) {
	isLoading.set(true);
	error.set(null);

	try {
		const supabase = getSupabaseClient();

		// Fetch party
		const { data: partyData, error: partyError } = await supabase
			.from('parties')
			.select('*')
			.eq('code', code.toUpperCase())
			.single();

		if (partyError || !partyData) {
			error.set('Party not found');
			isLoading.set(false);
			return false;
		}

		party.set(partyData);

		// Update theme with party colors
		theme.setTeams({
			rowColor: partyData.team_row_color,
			colColor: partyData.team_col_color,
			rowName: partyData.team_row_name,
			colName: partyData.team_col_name
		});

		// Fetch squares
		const { data: squaresData } = await supabase
			.from('squares')
			.select('*')
			.eq('party_id', partyData.id)
			.order('row_num')
			.order('col_num');

		squares.set(squaresData || []);

		// Fetch numbers if locked
		if (partyData.status !== 'filling') {
			const { data: numbersData } = await supabase
				.from('numbers')
				.select('*')
				.eq('party_id', partyData.id)
				.single();

			numbers.set(numbersData || null);
		}

		// Fetch scores
		const { data: scoresData } = await supabase
			.from('scores')
			.select('*')
			.eq('party_id', partyData.id)
			.single();

		scores.set(scoresData || null);

		// Fetch winners
		const { data: winnersData } = await supabase
			.from('winners')
			.select('*')
			.eq('party_id', partyData.id)
			.order('quarter');

		winners.set(winnersData || []);

		isLoading.set(false);
		return true;
	} catch {
		error.set('Failed to load party');
		isLoading.set(false);
		return false;
	}
}

// Handle broadcast messages from other clients
function handleBroadcastMessage(payload: { payload: BroadcastMessage }) {
	const message = payload.payload;

	// Ignore our own broadcasts
	if (isOwnBroadcast(message)) return;

	const currentSquares = get(squares);
	const key = message.squareKey;
	const [row, col] = key.split('-').map(Number);

	if (message.type === 'claim_intent') {
		// Another user is claiming - show optimistically with pending state
		const existingSquare = currentSquares.find((s) => s.row_num === row && s.col_num === col);
		if (!existingSquare || existingSquare.player_name) return; // Already claimed

		// Add to pending operations (as "other user's pending")
		pendingOperations.update((ops) => {
			const newOps = new Map(ops);
			newOps.set(key, {
				id: `remote-${message.clientId}-${key}`,
				type: 'claim',
				row,
				col,
				timestamp: message.timestamp,
				status: 'pending',
				originalState: {
					player_name: existingSquare.player_name,
					player_name_lower: existingSquare.player_name_lower,
					claimed_at: existingSquare.claimed_at
				}
			});
			return newOps;
		});

		// Optimistically show the claim
		squares.update((current) =>
			current.map((s) =>
				s.row_num === row && s.col_num === col
					? {
							...s,
							player_name: message.playerName,
							player_name_lower: message.playerName.toLowerCase(),
							claimed_at: new Date().toISOString()
						}
					: s
			)
		);

		// Schedule timeout cleanup for remote pending operations
		schedulePendingTimeout(key);
	} else if (message.type === 'claim_rejected') {
		// Another user's claim was rejected - remove their pending claim
		pendingOperations.update((ops) => {
			const newOps = new Map(ops);
			const op = newOps.get(key);
			if (op && op.id.startsWith('remote-')) {
				// Rollback to original state
				squares.update((current) =>
					current.map((s) =>
						s.row_num === row && s.col_num === col
							? {
									...s,
									player_name: op.originalState.player_name,
									player_name_lower: op.originalState.player_name_lower,
									claimed_at: op.originalState.claimed_at
								}
							: s
					)
				);
				newOps.delete(key);
			}
			return newOps;
		});
	} else if (message.type === 'unclaim_intent') {
		// Another user is unclaiming - show optimistically
		const existingSquare = currentSquares.find((s) => s.row_num === row && s.col_num === col);
		if (!existingSquare || !existingSquare.player_name) return;

		squares.update((current) =>
			current.map((s) =>
				s.row_num === row && s.col_num === col
					? { ...s, player_name: null, player_name_lower: null, claimed_at: null }
					: s
			)
		);
	}
}

export function subscribeToParty(partyId: string) {
	const supabase = getSupabaseClient();

	// Unsubscribe from previous channels
	if (channel) {
		channel.unsubscribe();
	}
	if (broadcastChannel) {
		broadcastChannel.unsubscribe();
	}

	// Set up broadcast channel for fast optimistic updates
	broadcastChannel = supabase
		.channel(`party-broadcast:${partyId}`)
		.on('broadcast', { event: 'square_update' }, handleBroadcastMessage)
		.subscribe();

	channel = supabase
		.channel(`party:${partyId}`)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'squares',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'UPDATE') {
					const newSquare = payload.new as Square;
					const key = squareKey(newSquare.row_num, newSquare.col_num);

					// Clear any pending operation and timeout for this square - database is source of truth
					clearPendingTimeout(key);
					pendingOperations.update((ops) => {
						const newOps = new Map(ops);
						newOps.delete(key);
						return newOps;
					});

					// Update with confirmed state from database
					squares.update((current) =>
						current.map((s) => (s.id === newSquare.id ? newSquare : s))
					);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'parties',
				filter: `id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'UPDATE') {
					party.set(payload.new as Party);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'numbers',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
					numbers.set(payload.new as Numbers);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'scores',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
					scores.set(payload.new as Scores);
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: 'INSERT',
				schema: 'public',
				table: 'winners',
				filter: `party_id=eq.${partyId}`
			},
			(payload) => {
				winners.update((current) => [...current, payload.new as Winner]);
			}
		)
		.subscribe();

	return () => {
		if (channel) {
			channel.unsubscribe();
			channel = null;
		}
	};
}

// Broadcast a message to other clients
function broadcast(partyId: string, message: Omit<BroadcastMessage, 'clientId'>) {
	if (!broadcastChannel) return;

	broadcastChannel.send({
		type: 'broadcast',
		event: 'square_update',
		payload: { ...message, clientId }
	});
}

// Schedule timeout cleanup for pending operations
function schedulePendingTimeout(key: string) {
	// Clear any existing timeout for this key
	const existingTimeout = pendingTimeouts.get(key);
	if (existingTimeout) {
		clearTimeout(existingTimeout);
	}

	const timeoutId = setTimeout(() => {
		pendingTimeouts.delete(key);
		pendingOperations.update((ops) => {
			const op = ops.get(key);
			if (op && op.status === 'pending') {
				// Operation timed out - rollback
				const newOps = new Map(ops);
				newOps.delete(key);

				// Rollback the square state
				squares.update((current) =>
					current.map((s) =>
						s.row_num === op.row && s.col_num === op.col
							? {
									...s,
									player_name: op.originalState.player_name,
									player_name_lower: op.originalState.player_name_lower,
									claimed_at: op.originalState.claimed_at
								}
							: s
					)
				);

				toast.error('Claim timed out - please try again');
				return newOps;
			}
			return ops;
		});
	}, PENDING_TIMEOUT_MS);

	pendingTimeouts.set(key, timeoutId);
}

// Clear a pending timeout when operation is confirmed
function clearPendingTimeout(key: string) {
	const timeoutId = pendingTimeouts.get(key);
	if (timeoutId) {
		clearTimeout(timeoutId);
		pendingTimeouts.delete(key);
	}
}

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
			claimed_at: existingSquare.claimed_at
		}
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
						claimed_at: new Date().toISOString()
					}
				: s
		)
	);

	// 3. Broadcast intent to other clients
	broadcast(currentParty.id, {
		type: 'claim_intent',
		squareKey: key,
		playerName: currentUser,
		timestamp
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
			p_player_name: currentUser
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
											claimed_at: op.originalState.claimed_at
										}
									: s
							)
						);

						// Broadcast rejection to other clients
						broadcast(currentParty.id, {
							type: 'claim_rejected',
							squareKey: key,
							playerName: currentUser,
							timestamp
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
			claimed_at: existingSquare.claimed_at
		}
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
		timestamp
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
			p_player_name: currentUser
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
											claimed_at: op.originalState.claimed_at
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
						claimed_at: existingSquare.claimed_at
					}
				}
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
						claimed_at: new Date().toISOString()
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
			timestamp
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
			p_cells: claimableCells
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
		p_player_name: currentUser
	});

	if (claimError) {
		toast.error('Failed to claim square');
		return false;
	}

	return true;
}

export async function claimSquaresBatch(cells: Array<{ row: number; col: number }>): Promise<number> {
	const currentParty = get(party);
	const currentUser = get(userName);

	if (!currentParty || !currentUser || cells.length === 0) return 0;
	if (currentParty.status !== 'filling') return 0;

	const supabase = getSupabaseClient();

	const { data, error: claimError } = await supabase.rpc('claim_squares_batch', {
		p_party_id: currentParty.id,
		p_player_name: currentUser,
		p_cells: cells
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
		p_player_name: currentUser
	});

	return !unclaimError;
}

export async function lockParty(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: lockError } = await supabase.rpc('lock_party', {
		p_party_id: currentParty.id,
		p_pin: pin
	});

	if (lockError) {
		return { success: false, error: 'Failed to lock party. Please try again.' };
	}

	if (!data) {
		return { success: false, error: 'Failed to lock - check PIN and ensure all squares are filled' };
	}

	return { success: true };
}

export async function startGame(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: startError } = await supabase.rpc('start_game', {
		p_party_id: currentParty.id,
		p_pin: pin
	});

	if (startError) {
		return { success: false, error: 'Failed to start game. Please try again.' };
	}

	if (!data) {
		return { success: false, error: 'Failed to start game - check PIN' };
	}

	return { success: true };
}

export async function updateScore(
	pin: string,
	quarter: 'q1' | 'q2' | 'q3' | 'final',
	rowScore: number,
	colScore: number
): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	const supabase = getSupabaseClient();

	const { data, error: scoreError } = await supabase.rpc('update_score', {
		p_party_id: currentParty.id,
		p_pin: pin,
		p_quarter: quarter,
		p_row_score: rowScore,
		p_col_score: colScore
	});

	if (scoreError) {
		return { success: false, error: 'Failed to update score. Please try again.' };
	}

	if (!data) {
		return { success: false, error: 'Failed to update score - check PIN' };
	}

	return { success: true };
}

export async function updatePayoutStructure(
	pin: string,
	splits: { q1: number; q2: number; q3: number; final: number }
): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };
	if (currentParty.status !== 'filling') return { success: false, error: 'Grid is already locked' };

	// Verify PIN matches
	if (pin !== currentParty.host_pin) {
		return { success: false, error: 'Invalid PIN' };
	}

	// Verify splits add up to 100
	const total = splits.q1 + splits.q2 + splits.q3 + splits.final;
	if (total !== 100) {
		return { success: false, error: 'Splits must add up to 100%' };
	}

	const supabase = getSupabaseClient();

	const { error: updateError } = await supabase
		.from('parties')
		.update({
			split_q1: splits.q1,
			split_q2: splits.q2,
			split_q3: splits.q3,
			split_final: splits.final
		})
		.eq('id', currentParty.id)
		.eq('host_pin', pin);

	if (updateError) {
		return { success: false, error: 'Failed to update payout structure. Please try again.' };
	}

	// Update local state
	party.update((p) =>
		p
			? {
					...p,
					split_q1: splits.q1,
					split_q2: splits.q2,
					split_q3: splits.q3,
					split_final: splits.final
				}
			: null
	);

	return { success: true };
}

export async function removePlayer(
	pin: string,
	playerNameLower: string
): Promise<{ success: boolean; removedCount: number; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, removedCount: 0, error: 'No party loaded' };

	// Only allow during filling phase
	if (currentParty.status !== 'filling') {
		return { success: false, removedCount: 0, error: 'Cannot remove players after grid is locked' };
	}

	// Verify PIN matches
	if (pin !== currentParty.host_pin) {
		return { success: false, removedCount: 0, error: 'Invalid PIN' };
	}

	const supabase = getSupabaseClient();

	// Remove all squares owned by this player
	const { data, error: removeError } = await supabase
		.from('squares')
		.update({ player_name: null, player_name_lower: null, claimed_at: null })
		.eq('party_id', currentParty.id)
		.eq('player_name_lower', playerNameLower)
		.select('id');

	if (removeError) {
		return { success: false, removedCount: 0, error: 'Failed to remove player. Please try again.' };
	}

	const removedCount = data?.length || 0;

	// Update local state
	squares.update((current) =>
		current.map((s) =>
			s.player_name_lower === playerNameLower
				? { ...s, player_name: null, player_name_lower: null, claimed_at: null }
				: s
		)
	);

	return { success: true, removedCount };
}

export async function deleteParty(pin: string): Promise<{ success: boolean; error?: string }> {
	const currentParty = get(party);
	if (!currentParty) return { success: false, error: 'No party loaded' };

	// Verify PIN matches
	if (pin !== currentParty.host_pin) {
		return { success: false, error: 'Invalid PIN' };
	}

	const supabase = getSupabaseClient();

	// Delete party (cascades to squares, numbers, scores, winners)
	const { error: deleteError } = await supabase
		.from('parties')
		.delete()
		.eq('id', currentParty.id)
		.eq('host_pin', pin);

	if (deleteError) {
		return { success: false, error: 'Failed to delete party. Please try again.' };
	}

	return { success: true };
}

export function cleanup() {
	// Clear all pending timeouts
	for (const timeoutId of pendingTimeouts.values()) {
		clearTimeout(timeoutId);
	}
	pendingTimeouts.clear();

	if (channel) {
		channel.unsubscribe();
		channel = null;
	}
	if (broadcastChannel) {
		broadcastChannel.unsubscribe();
		broadcastChannel = null;
	}
	party.set(null);
	squares.set([]);
	numbers.set(null);
	scores.set(null);
	winners.set([]);
	pendingOperations.set(new Map());
	isLoading.set(true);
	error.set(null);
}

export async function verifyHostPin(code: string, pin: string): Promise<boolean> {
	const supabase = getSupabaseClient();

	const { data, error } = await supabase.rpc('verify_host_pin', {
		p_party_code: code,
		p_pin: pin
	});

	if (error) {
		return false;
	}

	return data === true;
}
