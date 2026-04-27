import { get, writable, type Readable } from 'svelte/store';
import type { RealtimeChannel, REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { getSupabaseClient } from '$lib/supabase';
import type { BroadcastMessage } from '$lib/types';
import {
	parseSquare,
	parseParty,
	parseNumbers,
	parseScores,
	parseWinner,
	parseWinnerArray,
	parseGameScores,
} from '$lib/validators/realtime';
import { toast } from './toast';
import {
	clientId,
	squares,
	party,
	scores,
	winners,
	pendingOperations,
	pendingTimeouts,
	PENDING_TIMEOUT_MS,
	applySquareUpdate,
	applyPartyUpdate,
	applyNumbersUpdate,
	applyScoresUpdate,
	applyWinnerInsert,
	applyWinnerUpdate,
	applyWinnerDelete,
	applyGameScoresUpdate,
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

// ─── Connection status (surfaced to the UI via ConnectionBanner) ──────────
export type ConnectionStatus = 'connected' | 'reconnecting' | 'failed';

export interface ConnectionStatusState {
	status: ConnectionStatus;
	attempt: number;
}

const _connectionStatus = writable<ConnectionStatusState>({ status: 'connected', attempt: 0 });

/** Public read-only store of the realtime connection status. */
export const connectionStatus: Readable<ConnectionStatusState> = {
	subscribe: _connectionStatus.subscribe,
};

function recomputeAggregateStatus() {
	let maxAttempts = 0;
	let anyFailed = false;
	let anyReconnecting = false;
	for (const state of Object.values(channelStates)) {
		if (state.reconnectAttempts >= MAX_RECONNECT) anyFailed = true;
		else if (state.reconnectAttempts > 0) anyReconnecting = true;
		if (state.reconnectAttempts > maxAttempts) maxAttempts = state.reconnectAttempts;
	}
	if (anyFailed) {
		_connectionStatus.set({ status: 'failed', attempt: maxAttempts });
	} else if (anyReconnecting) {
		_connectionStatus.set({ status: 'reconnecting', attempt: maxAttempts });
	} else {
		_connectionStatus.set({ status: 'connected', attempt: 0 });
	}
}

function scheduleReconnect(channelKey: string, setupFn: () => void) {
	const state = channelStates[channelKey];
	if (state.reconnectAttempts >= MAX_RECONNECT) {
		recomputeAggregateStatus();
		return;
	}

	// Cancel any existing reconnect timeout to prevent race conditions
	if (state.reconnectTimeout) {
		clearTimeout(state.reconnectTimeout);
		state.reconnectTimeout = null;
	}

	state.reconnectAttempts++;
	recomputeAggregateStatus();
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
	recomputeAggregateStatus();
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

				toast.error("We couldn't reach the server. Your claim wasn't saved — try again.");
				return newOps;
			}
			return ops;
		});
	}, PENDING_TIMEOUT_MS);

	pendingTimeouts.set(key, timeoutId);
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
		.then(({ data, error }) => {
			if (error) {
				// eslint-disable-next-line no-console -- diagnostic; Phase 8 routes to Sentry
				console.warn('[realtime] failed to refetch scores after broadcast:', error.message);
				return;
			}
			const parsed = parseScores(data);
			if (parsed) scores.set(parsed);
		});

	supabase
		.from('winners')
		.select('*')
		.eq('party_id', currentParty.id)
		.order('quarter')
		.then(({ data, error }) => {
			if (error) {
				// eslint-disable-next-line no-console -- diagnostic; Phase 8 routes to Sentry
				console.warn('[realtime] failed to refetch winners after broadcast:', error.message);
				return;
			}
			const parsed = parseWinnerArray(data);
			if (parsed) winners.set(parsed);
		});
}

function setupBroadcastChannel(partyId: string) {
	const supabase = getSupabaseClient();
	channelStates.broadcast.channel = supabase
		.channel(`party-broadcast:${partyId}`)
		.on('broadcast', { event: 'square_update' }, handleBroadcastMessage)
		.on('broadcast', { event: 'score_update' }, handleScoreUpdateBroadcast)
		.subscribe((status) => {
			handleChannelStatus('broadcast', status, () => setupBroadcastChannel(partyId));
		});
}

function setupPartyChannel(partyId: string) {
	const supabase = getSupabaseClient();
	channelStates.party.channel = supabase
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
					const newSquare = parseSquare(payload.new);
					if (newSquare) applySquareUpdate(newSquare);
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
					const newParty = parseParty(payload.new);
					if (newParty) applyPartyUpdate(newParty);
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
					const newNumbers = parseNumbers(payload.new);
					if (newNumbers) applyNumbersUpdate(newNumbers);
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
					const newScores = parseScores(payload.new);
					if (newScores) applyScoresUpdate(newScores);
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
					const newWinner = parseWinner(payload.new);
					if (newWinner) applyWinnerInsert(newWinner);
				} else if (payload.eventType === 'UPDATE') {
					const newWinner = parseWinner(payload.new);
					if (newWinner) applyWinnerUpdate(newWinner);
				} else if (payload.eventType === 'DELETE') {
					const deleted = parseWinner(payload.old);
					if (deleted) applyWinnerDelete(deleted);
				}
			}
		)
		.subscribe((status) => {
			handleChannelStatus('party', status, () => setupPartyChannel(partyId));
		});
}

function setupGameChannel(gameId: string) {
	const supabase = getSupabaseClient();
	channelStates.game.channel = supabase
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
					const newGameScores = parseGameScores(payload.new);
					if (newGameScores) applyGameScoresUpdate(newGameScores);
				} else if (payload.eventType === 'DELETE') {
					applyGameScoresUpdate(null);
				}
			}
		)
		.subscribe((status) => {
			handleChannelStatus('game', status, () => setupGameChannel(gameId));
		});
}

export function subscribeToParty(partyId: string, gameId: string | null = null) {
	// Unsubscribe from previous channels and clear reconnect state.
	// IMPORTANT: resetReconnectState() must be called BEFORE setting up new channels
	// to cancel any pending reconnect timeouts that might capture stale partyId/gameId.
	if (channelStates.party.channel) {
		channelStates.party.channel.unsubscribe();
		resetReconnectState('party');
	}
	if (channelStates.broadcast.channel) {
		channelStates.broadcast.channel.unsubscribe();
		resetReconnectState('broadcast');
	}
	if (channelStates.game.channel) {
		channelStates.game.channel.unsubscribe();
		channelStates.game.channel = null;
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
		if (channelStates.party.channel) {
			channelStates.party.channel.unsubscribe();
			channelStates.party.channel = null;
			resetReconnectState('party');
		}
		if (channelStates.broadcast.channel) {
			channelStates.broadcast.channel.unsubscribe();
			channelStates.broadcast.channel = null;
			resetReconnectState('broadcast');
		}
		if (channelStates.game.channel) {
			channelStates.game.channel.unsubscribe();
			channelStates.game.channel = null;
			resetReconnectState('game');
		}
	};
}

// Broadcast a message to other clients
export function broadcast(partyId: string, message: Omit<BroadcastMessage, 'clientId'>) {
	if (!channelStates.broadcast.channel) return;

	channelStates.broadcast.channel.send({
		type: 'broadcast',
		event: 'square_update',
		payload: { ...message, clientId },
	});
}

// Broadcast score update notification to other clients
export function broadcastScoreUpdate() {
	if (!channelStates.broadcast.channel) return;

	channelStates.broadcast.channel.send({
		type: 'broadcast',
		event: 'score_update',
		payload: { clientId },
	});
}

// Cleanup channels (called from game-admin cleanup)
export function cleanupChannels() {
	if (channelStates.party.channel) {
		channelStates.party.channel.unsubscribe();
		channelStates.party.channel = null;
		resetReconnectState('party');
	}
	if (channelStates.broadcast.channel) {
		channelStates.broadcast.channel.unsubscribe();
		channelStates.broadcast.channel = null;
		resetReconnectState('broadcast');
	}
	if (channelStates.game.channel) {
		channelStates.game.channel.unsubscribe();
		channelStates.game.channel = null;
		resetReconnectState('game');
	}
}
