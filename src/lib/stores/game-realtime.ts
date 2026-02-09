import { get } from 'svelte/store';
import type { RealtimeChannel, REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { getSupabaseClient } from '$lib/supabase';
import type {
	Square,
	Numbers,
	Scores,
	Winner,
	Party,
	BroadcastMessage,
	GameScoresRow,
} from '$lib/types';
import { toast } from './toast';
import {
	clientId,
	squares,
	party,
	numbers,
	scores,
	winners,
	gameScores,
	pendingOperations,
	pendingTimeouts,
	squareKey,
	PENDING_TIMEOUT_MS,
} from './game-state';

/**
 * Per-channel reconnection state for handling connection failures.
 *
 * Cleanup semantics:
 * - When a component unmounts or party changes, resetReconnectState() is called
 * - This clears any pending reconnectTimeout to prevent stale closures from firing
 * - The reconnectAttempts counter is reset to allow fresh reconnection attempts
 * - Channel references are set to null to prevent memory leaks
 *
 * The cleanup order is important:
 * 1. Unsubscribe from channel (stops receiving events)
 * 2. Set channelStates[key].channel to null (remove reference)
 * 3. Call resetReconnectState() (cancel pending timeout, reset counter)
 */
interface ChannelState {
	channel: RealtimeChannel | null;
	reconnectAttempts: number;
	reconnectTimeout: ReturnType<typeof setTimeout> | null;
}

const channelStates: Record<string, ChannelState> = {
	party: { channel: null, reconnectAttempts: 0, reconnectTimeout: null },
	broadcast: { channel: null, reconnectAttempts: 0, reconnectTimeout: null },
	game: { channel: null, reconnectAttempts: 0, reconnectTimeout: null },
};

const MAX_RECONNECT = 5;
const BASE_DELAY = 1000;

function scheduleReconnect(channelKey: string, setupFn: () => void) {
	const state = channelStates[channelKey];
	if (state.reconnectAttempts >= MAX_RECONNECT) {
		return;
	}

	// Cancel any existing reconnect timeout to prevent race conditions
	if (state.reconnectTimeout) {
		clearTimeout(state.reconnectTimeout);
		state.reconnectTimeout = null;
	}

	state.reconnectAttempts++;
	// Add jitter to prevent thundering herd
	const jitter = Math.random() * 500;
	const delay = Math.min(BASE_DELAY * Math.pow(2, state.reconnectAttempts - 1), 16000) + jitter;

	state.reconnectTimeout = setTimeout(() => {
		if (state.channel) {
			state.channel.unsubscribe();
			state.channel = null;
		}
		setupFn();
	}, delay);
}

function resetReconnectState(channelKey: string) {
	const state = channelStates[channelKey];
	state.reconnectAttempts = 0;
	if (state.reconnectTimeout) {
		clearTimeout(state.reconnectTimeout);
		state.reconnectTimeout = null;
	}
}

function handleChannelStatus(
	channelKey: string,
	status: `${REALTIME_SUBSCRIBE_STATES}`,
	setupFn: () => void
) {
	if (status === 'SUBSCRIBED') {
		resetReconnectState(channelKey);
	} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
		scheduleReconnect(channelKey, setupFn);
	}
}

/**
 * Legacy aliases for backward compatibility.
 *
 * NOTE: The authoritative source of truth for channel references is `channelStates`.
 * These variables are maintained only to avoid breaking older code that still
 * imports them directly. New code MUST use `channelStates` instead.
 *
 * @deprecated Use `channelStates.party.channel` instead
 */
let channel: RealtimeChannel | null = null;
/** @deprecated Use `channelStates.broadcast.channel` instead */
let broadcastChannel: RealtimeChannel | null = null;
/** @deprecated Use `channelStates.game.channel` instead */
let gameChannel: RealtimeChannel | null = null;

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

function handleScoreUpdateBroadcast(payload: { payload: { clientId: string } }) {
	// Ignore our own broadcasts
	if (payload.payload.clientId === clientId) return;

	// Re-fetch scores and winners from the database (source of truth)
	const currentParty = get(party);
	if (!currentParty) return;

	const supabase = getSupabaseClient();

	supabase
		.from('scores')
		.select('*')
		.eq('party_id', currentParty.id)
		.single()
		.then(({ data }) => {
			if (data) scores.set(data as Scores);
		});

	supabase
		.from('winners')
		.select('*')
		.eq('party_id', currentParty.id)
		.order('quarter')
		.then(({ data }) => {
			if (data) winners.set(data as Winner[]);
		});
}

function setupBroadcastChannel(partyId: string) {
	const supabase = getSupabaseClient();
	broadcastChannel = supabase
		.channel(`party-broadcast:${partyId}`)
		.on('broadcast', { event: 'square_update' }, handleBroadcastMessage)
		.on('broadcast', { event: 'score_update' }, handleScoreUpdateBroadcast)
		.subscribe((status) => {
			handleChannelStatus('broadcast', status, () => setupBroadcastChannel(partyId));
		});
	channelStates.broadcast.channel = broadcastChannel;
}

function setupPartyChannel(partyId: string) {
	const supabase = getSupabaseClient();
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
				event: '*',
				schema: 'public',
				table: 'winners',
				filter: `party_id=eq.${partyId}`,
			},
			(payload) => {
				if (payload.eventType === 'INSERT') {
					winners.update((current) => [...current, payload.new as Winner]);
				} else if (payload.eventType === 'UPDATE') {
					winners.update((current) =>
						current.map((w) =>
							w.party_id === (payload.new as Winner).party_id &&
							w.quarter === (payload.new as Winner).quarter
								? (payload.new as Winner)
								: w
						)
					);
				} else if (payload.eventType === 'DELETE') {
					const deleted = payload.old as Winner;
					winners.update((current) =>
						current.filter(
							(w) => !(w.party_id === deleted.party_id && w.quarter === deleted.quarter)
						)
					);
				}
			}
		)
		.subscribe((status) => {
			handleChannelStatus('party', status, () => setupPartyChannel(partyId));
		});
	channelStates.party.channel = channel;
}

function setupGameChannel(gameId: string) {
	const supabase = getSupabaseClient();
	gameChannel = supabase
		.channel(`game:${gameId}`)
		.on(
			'postgres_changes',
			{
				event: '*',
				schema: 'public',
				table: 'game_scores',
				filter: `game_id=eq.${gameId}`,
			},
			(payload) => {
				if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
					gameScores.set(payload.new as GameScoresRow);
				} else if (payload.eventType === 'DELETE') {
					gameScores.set(null);
				}
			}
		)
		.subscribe((status) => {
			handleChannelStatus('game', status, () => setupGameChannel(gameId));
		});
	channelStates.game.channel = gameChannel;
}

export function subscribeToParty(partyId: string, gameId: string | null = null) {
	// Unsubscribe from previous channels and clear reconnect state.
	// IMPORTANT: resetReconnectState() must be called BEFORE setting up new channels
	// to cancel any pending reconnect timeouts that might capture stale partyId/gameId.
	if (channel) {
		channel.unsubscribe();
		resetReconnectState('party');
	}
	if (broadcastChannel) {
		broadcastChannel.unsubscribe();
		resetReconnectState('broadcast');
	}
	if (gameChannel) {
		gameChannel.unsubscribe();
		gameChannel = null;
		resetReconnectState('game');
	}

	// Set up channels with reconnection support
	setupBroadcastChannel(partyId);
	setupPartyChannel(partyId);

	// Subscribe to live game scores if party is linked to a game
	if (gameId) {
		setupGameChannel(gameId);
	}

	return () => {
		if (channel) {
			channel.unsubscribe();
			channel = null;
			channelStates.party.channel = null;
			resetReconnectState('party');
		}
		if (broadcastChannel) {
			broadcastChannel.unsubscribe();
			broadcastChannel = null;
			channelStates.broadcast.channel = null;
			resetReconnectState('broadcast');
		}
		if (gameChannel) {
			gameChannel.unsubscribe();
			gameChannel = null;
			channelStates.game.channel = null;
			resetReconnectState('game');
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

// Broadcast score update notification to other clients
export function broadcastScoreUpdate() {
	if (!broadcastChannel) return;

	broadcastChannel.send({
		type: 'broadcast',
		event: 'score_update',
		payload: { clientId },
	});
}

// Cleanup channels (called from game-admin cleanup)
export function cleanupChannels() {
	if (channel) {
		channel.unsubscribe();
		channel = null;
		channelStates.party.channel = null;
		resetReconnectState('party');
	}
	if (broadcastChannel) {
		broadcastChannel.unsubscribe();
		broadcastChannel = null;
		channelStates.broadcast.channel = null;
		resetReconnectState('broadcast');
	}
	if (gameChannel) {
		gameChannel.unsubscribe();
		gameChannel = null;
		channelStates.game.channel = null;
		resetReconnectState('game');
	}
}
