import { get } from 'svelte/store';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { getSupabaseClient } from '$lib/supabase';
import type { Square, Numbers, Scores, Winner, Party, BroadcastMessage } from '$lib/types';
import { toast } from './toast';
import {
	clientId,
	squares,
	party,
	numbers,
	scores,
	winners,
	pendingOperations,
	pendingTimeouts,
	squareKey,
	PENDING_TIMEOUT_MS,
} from './game-state';

// Channel management
let channel: RealtimeChannel | null = null;
let broadcastChannel: RealtimeChannel | null = null;

// Helper to check if an operation is from this client
function isOwnBroadcast(message: BroadcastMessage): boolean {
	return message.clientId === clientId;
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
									claimed_at: op.originalState.claimed_at,
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
					claimed_at: existingSquare.claimed_at,
				},
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
							claimed_at: new Date().toISOString(),
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
									claimed_at: op.originalState.claimed_at,
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
				filter: `party_id=eq.${partyId}`,
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
					squares.update((current) => current.map((s) => (s.id === newSquare.id ? newSquare : s)));
				}
			}
		)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'parties',
				filter: `id=eq.${partyId}`,
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
				filter: `party_id=eq.${partyId}`,
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
				filter: `party_id=eq.${partyId}`,
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
				filter: `party_id=eq.${partyId}`,
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
		if (broadcastChannel) {
			broadcastChannel.unsubscribe();
			broadcastChannel = null;
		}
	};
}

// Broadcast a message to other clients
export function broadcast(partyId: string, message: Omit<BroadcastMessage, 'clientId'>) {
	if (!broadcastChannel) return;

	broadcastChannel.send({
		type: 'broadcast',
		event: 'square_update',
		payload: { ...message, clientId },
	});
}

// Cleanup channels (called from game-admin cleanup)
export function cleanupChannels() {
	if (channel) {
		channel.unsubscribe();
		channel = null;
	}
	if (broadcastChannel) {
		broadcastChannel.unsubscribe();
		broadcastChannel = null;
	}
}
