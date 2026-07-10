import { get, writable, type Readable } from 'svelte/store';
import type { RealtimeChannel, REALTIME_SUBSCRIBE_STATES } from '@supabase/supabase-js';
import { browser } from '$app/environment';
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

// Monotonic subscription generation. Every (re)subscribe and every intentional
// teardown bumps this; each channel's status callback captures the generation it
// was created under and only (re)connects while that generation is still current.
// This defeats the CLOSED event Supabase fires ASYNCHRONOUSLY after an intentional
// unsubscribe(): the stale callback's captured generation no longer matches, so it
// can never resurrect a channel for a party we've already left or navigated away from.
let currentGeneration = 0;

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

// ─── Network connectivity (independent of the realtime channel status) ───
// navigator.onLine + window 'online'/'offline' events reflect actual browser
// network connectivity — distinct from connectionStatus above, which only
// tracks the Supabase realtime channel's own connect/reconnect lifecycle.
// A user can be fully offline (no network at all) while connectionStatus is
// still 'connected' from its last known state, or the reverse.
//
// SSR-safe: navigator/window are undefined during SvelteKit server render,
// so every access is guarded by `browser` from $app/environment (same guard
// theme.ts uses for its own browser-only DOM access).
const _isOffline = writable<boolean>(browser ? !navigator.onLine : false);

/** Public read-only store reflecting actual network connectivity (navigator.onLine). */
export const isOffline: Readable<boolean> = { subscribe: _isOffline.subscribe };

function handleNetworkOnline() {
	_isOffline.set(false);
}

function handleNetworkOffline() {
	_isOffline.set(true);
}

let offlineListenersActive = false;

/**
 * Resync isOffline from the current navigator.onLine value, and register the
 * window online/offline listeners exactly once. Safe to call on every
 * subscribeToParty() — idempotent, mirrors the channel setup below.
 */
function registerOfflineListeners() {
	if (!browser) return;
	_isOffline.set(!navigator.onLine);
	if (offlineListenersActive) return;
	window.addEventListener('online', handleNetworkOnline);
	window.addEventListener('offline', handleNetworkOffline);
	offlineListenersActive = true;
}

/**
 * Tear down the window online/offline listeners and resync isOffline to the
 * current navigator.onLine value. Mirrors cleanupChannels()'s teardown of the
 * realtime channels — called from there so listeners never leak across
 * navigations.
 */
function unregisterOfflineListeners() {
	if (browser && offlineListenersActive) {
		window.removeEventListener('online', handleNetworkOnline);
		window.removeEventListener('offline', handleNetworkOffline);
		offlineListenersActive = false;
	}
	_isOffline.set(browser ? !navigator.onLine : false);
}

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
	setupFn: () => void,
	generation: number
) {
	// Ignore any status from a channel that belongs to a superseded generation —
	// e.g. the async CLOSED delivered after an intentional unsubscribe(). Without
	// this guard, CLOSED would schedule a reconnect that resurrects a channel for a
	// party we've already left (or unsubscribes the new party's channel to reopen the old).
	if (generation !== currentGeneration) return;

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

				// Only alert the user about THEIR OWN failed operation. Remote ops
				// (id "remote-<clientId>-<key>") are mirrors of another client's action;
				// their timeout is a silent self-heal, not something this user did.
				if (!op.id.startsWith('remote-')) {
					toast.error("We couldn't reach the server. Your claim wasn't saved — try again.");
				}
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
		// Another user's claim was rejected - remove ONLY that user's pending claim.
		// Match on the full remote op id (remote-<clientId>-<key>) so a rejection from
		// one client can never roll back a different client's still-valid pending preview.
		pendingOperations.update((ops) => {
			const newOps = new Map(ops);
			const op = newOps.get(key);
			if (op && op.id === `remote-${message.clientId}-${key}`) {
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
		// Another user is unclaiming - show optimistically.
		const existingSquare = currentSquares.find((s) => s.row_num === row && s.col_num === col);
		if (!existingSquare || !existingSquare.player_name) return;

		// Track as a pending op (symmetric with remote claim_intent) so we can self-heal
		// if the unclaim is rejected server-side. A rejected unclaim_square changes ZERO
		// rows, so no postgres_changes event arrives to restore the square — the pending
		// op's timeout (or an unclaim_rejected broadcast) is the only thing that heals us.
		pendingOperations.update((ops) => {
			const newOps = new Map(ops);
			newOps.set(key, {
				id: `remote-${message.clientId}-${key}`,
				type: 'unclaim',
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

		squares.update((current) =>
			current.map((s) =>
				s.row_num === row && s.col_num === col
					? { ...s, player_name: null, player_name_lower: null, claimed_at: null }
					: s
			)
		);

		// Schedule timeout cleanup for the remote pending unclaim
		schedulePendingTimeout(key);
	} else if (message.type === 'unclaim_rejected') {
		// The unclaiming client's server call was rejected - restore the square we cleared.
		// Match on the full remote op id so only the pending op we created for THIS client's
		// unclaim is restored.
		pendingOperations.update((ops) => {
			const newOps = new Map(ops);
			const op = newOps.get(key);
			if (op && op.id === `remote-${message.clientId}-${key}`) {
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
				// eslint-disable-next-line no-console -- diagnostic
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
				// eslint-disable-next-line no-console -- diagnostic
				console.warn('[realtime] failed to refetch winners after broadcast:', error.message);
				return;
			}
			const parsed = parseWinnerArray(data);
			if (parsed) winners.set(parsed);
		});
}

function setupBroadcastChannel(partyId: string, generation: number) {
	const supabase = getSupabaseClient();
	channelStates.broadcast.channel = supabase
		.channel(`party-broadcast:${partyId}`)
		.on('broadcast', { event: 'square_update' }, handleBroadcastMessage)
		.on('broadcast', { event: 'score_update' }, handleScoreUpdateBroadcast)
		.subscribe((status) => {
			handleChannelStatus(
				'broadcast',
				status,
				() => setupBroadcastChannel(partyId, generation),
				generation
			);
		});
}

function setupPartyChannel(partyId: string, generation: number) {
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
			handleChannelStatus(
				'party',
				status,
				() => setupPartyChannel(partyId, generation),
				generation
			);
		});
}

function setupGameChannel(gameId: string, generation: number) {
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
			handleChannelStatus('game', status, () => setupGameChannel(gameId, generation), generation);
		});
}

export function subscribeToParty(partyId: string, gameId: string | null = null) {
	// Register (or resync) the offline-detection listeners for this session.
	registerOfflineListeners();

	// Bump the generation FIRST so any async CLOSED fired by the unsubscribe() calls
	// below is treated as stale and cannot schedule a reconnect against the old party.
	const generation = ++currentGeneration;

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
	setupBroadcastChannel(partyId, generation);
	setupPartyChannel(partyId, generation);

	// Subscribe to live game scores if party is linked to a game
	if (gameId) {
		setupGameChannel(gameId, generation);
	}

	return () => {
		// Bump the generation so the CLOSED events from these unsubscribes are ignored.
		++currentGeneration;
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
	// Bump the generation so the CLOSED events from these unsubscribes are ignored
	// and cannot resurrect a subscription after teardown.
	++currentGeneration;
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
	unregisterOfflineListeners();
}
