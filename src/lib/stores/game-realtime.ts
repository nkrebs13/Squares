import { get, writable, type Readable } from 'svelte/store';
import type {
	RealtimeChannel,
	RealtimePostgresChangesPayload,
	REALTIME_SUBSCRIBE_STATES,
} from '@supabase/supabase-js';
import { browser } from '$app/environment';
import { getSupabaseClient } from '$lib/supabase';
import type { BroadcastMessage } from '$lib/types';
import { logWarn } from '$lib/utils/log';
import {
	parseSquare,
	parseParty,
	parseNumbers,
	parseScores,
	parseWinner,
	parseWinnerArray,
	parseGameScores,
} from '$lib/validators/realtime';
import {
	clientId,
	squares,
	party,
	scores,
	winners,
	applyPartyUpdate,
	applyNumbersUpdate,
	applyScoresUpdate,
	applyWinnerInsert,
	applyWinnerUpdate,
	applyWinnerDelete,
	applyGameScoresUpdate,
} from './game-state';
import {
	addPendingOps,
	applySquareUpdate,
	clearSquareFields,
	newPendingOp,
	rollbackPendingOpIf,
} from './game-pending';
import { normalizePlayerName } from './user';
import { parseSquareKey } from '$lib/utils/squareKey';

/**
 * Per-channel reconnection state for handling connection failures.
 *
 * Cleanup semantics (see teardownChannels):
 * - When a component unmounts or party changes, every live channel is torn down
 * - resetReconnectState() clears any pending reconnectTimeout so stale closures
 *   never fire, and resets reconnectAttempts to allow fresh reconnection attempts
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
	// Monotonic per-key instance token, bumped every time a channel is (re)created
	// for this key. Each channel's status callback captures the token it was born
	// under; handleChannelStatus ignores any callback whose token is no longer the
	// current one. This is finer-grained than `currentGeneration` (which only bumps
	// on subscribe/teardown, NOT on the internal reconnect timer's replace-in-place):
	// it defeats the CLOSED an OLD channel fires ASYNCHRONOUSLY after the reconnect
	// timer unsubscribed it, which would otherwise pass the generation guard (same
	// generation) and schedule a reconnect that tears down the healthy NEW channel —
	// endless churn while the UI still reads "connected".
	instanceToken: number;
}

const channelStates: Record<string, ChannelState> = {
	party: { channel: null, reconnectAttempts: 0, reconnectTimeout: null, instanceToken: 0 },
	broadcast: { channel: null, reconnectAttempts: 0, reconnectTimeout: null, instanceToken: 0 },
	game: { channel: null, reconnectAttempts: 0, reconnectTimeout: null, instanceToken: 0 },
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
	generation: number,
	token: number
) {
	// Ignore any status from a channel that belongs to a superseded generation —
	// e.g. the async CLOSED delivered after an intentional unsubscribe(). Without
	// this guard, CLOSED would schedule a reconnect that resurrects a channel for a
	// party we've already left (or unsubscribes the new party's channel to reopen the old).
	if (generation !== currentGeneration) return;

	// Ignore any status from a channel this key has since replaced in-place. The
	// internal reconnect timer swaps channelStates[key].channel WITHOUT bumping the
	// generation, so an OLD channel's late CLOSED shares the current generation and
	// would pass the guard above — then schedule a reconnect that unsubscribes the
	// healthy NEW channel. The instance token, bumped on every (re)creation, is what
	// distinguishes them.
	if (token !== channelStates[channelKey].instanceToken) return;

	if (status === 'SUBSCRIBED') {
		resetReconnectState(channelKey);
	} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
		scheduleReconnect(channelKey, setupFn);
	}
}

/**
 * Tear down every live channel in the fixed party → broadcast → game order:
 * unsubscribe, drop the reference, cancel its reconnect state. Callers bump
 * `currentGeneration` FIRST so the async CLOSED each unsubscribe() fires is
 * treated as stale and cannot schedule a reconnect.
 */
function teardownChannels() {
	for (const key of Object.keys(channelStates)) {
		const state = channelStates[key];
		if (!state.channel) continue;
		state.channel.unsubscribe();
		state.channel = null;
		resetReconnectState(key);
	}
}

// Another tab's claim or unclaim. Its intent is previewed as a remote pending
// op until postgres_changes confirms it, the sender reports a rejection, or the
// op's timeout heals it silently.
function handleBroadcastMessage(payload: { payload: BroadcastMessage }) {
	const message = payload.payload;
	if (message.clientId === clientId) return;

	const cell = parseSquareKey(message.squareKey);
	if (!cell) return;
	const key = message.squareKey;
	const fromSender = (op: { origin: string; clientId: string }) =>
		op.origin === 'remote' && op.clientId === message.clientId;

	if (message.type === 'claim_rejected' || message.type === 'unclaim_rejected') {
		rollbackPendingOpIf(key, fromSender);
		return;
	}

	const square = get(squares).find((s) => s.row_num === cell.row && s.col_num === cell.col);
	const claiming = message.type === 'claim_intent';
	if (!square || Boolean(square.player_name) === claiming) return;

	addPendingOps([
		newPendingOp(claiming ? 'claim' : 'unclaim', square, message.timestamp, {
			remoteClientId: message.clientId,
		}),
	]);
	squares.update((current) =>
		current.map((s) =>
			s.row_num !== cell.row || s.col_num !== cell.col
				? s
				: claiming
					? {
							...s,
							player_name: message.playerName,
							player_name_lower: normalizePlayerName(message.playerName),
							claimed_at: new Date(message.timestamp).toISOString(),
						}
					: clearSquareFields(s)
		)
	);
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
				logWarn('[realtime] failed to refetch scores after broadcast:', error.message);
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
				logWarn('[realtime] failed to refetch winners after broadcast:', error.message);
				return;
			}
			const parsed = parseWinnerArray(data);
			if (parsed) winners.set(parsed);
		});
}

function setupBroadcastChannel(partyId: string, generation: number) {
	const supabase = getSupabaseClient();
	const token = ++channelStates.broadcast.instanceToken;
	channelStates.broadcast.channel = supabase
		.channel(`party-broadcast:${partyId}`)
		.on('broadcast', { event: 'square_update' }, handleBroadcastMessage)
		.on('broadcast', { event: 'score_update' }, handleScoreUpdateBroadcast)
		.subscribe((status) => {
			handleChannelStatus(
				'broadcast',
				status,
				() => setupBroadcastChannel(partyId, generation),
				generation,
				token
			);
		});
}

type PostgresChangesPayload = RealtimePostgresChangesPayload<Record<string, unknown>>;

/**
 * The five tables the party channel listens to (postgres_changes is the source
 * of truth). Each row is filtered to this party by `filterColumn`, and its
 * handler validates the payload before applying it to state.
 */
const PARTY_TABLE_SUBSCRIPTIONS: ReadonlyArray<{
	table: string;
	filterColumn: 'party_id' | 'id';
	handle: (payload: PostgresChangesPayload) => void;
}> = [
	{
		table: 'squares',
		filterColumn: 'party_id',
		handle: (payload) => {
			if (payload.eventType === 'UPDATE') {
				const newSquare = parseSquare(payload.new);
				if (newSquare) applySquareUpdate(newSquare);
			}
		},
	},
	{
		table: 'parties',
		filterColumn: 'id',
		handle: (payload) => {
			if (payload.eventType === 'UPDATE') {
				const newParty = parseParty(payload.new);
				if (newParty) applyPartyUpdate(newParty);
			}
		},
	},
	{
		table: 'numbers',
		filterColumn: 'party_id',
		handle: (payload) => {
			if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
				const newNumbers = parseNumbers(payload.new);
				if (newNumbers) applyNumbersUpdate(newNumbers);
			}
		},
	},
	{
		table: 'scores',
		filterColumn: 'party_id',
		handle: (payload) => {
			if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
				const newScores = parseScores(payload.new);
				if (newScores) applyScoresUpdate(newScores);
			}
		},
	},
	{
		table: 'winners',
		filterColumn: 'party_id',
		handle: (payload) => {
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
		},
	},
];

function setupPartyChannel(partyId: string, generation: number) {
	const supabase = getSupabaseClient();
	const token = ++channelStates.party.instanceToken;
	let channel = supabase.channel(`party:${partyId}`);
	for (const { table, filterColumn, handle } of PARTY_TABLE_SUBSCRIPTIONS) {
		channel = channel.on(
			'postgres_changes',
			{ event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${partyId}` },
			handle
		);
	}
	channelStates.party.channel = channel.subscribe((status) => {
		handleChannelStatus(
			'party',
			status,
			() => setupPartyChannel(partyId, generation),
			generation,
			token
		);
	});
}

function setupGameChannel(gameId: string, generation: number) {
	const supabase = getSupabaseClient();
	const token = ++channelStates.game.instanceToken;
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
			handleChannelStatus(
				'game',
				status,
				() => setupGameChannel(gameId, generation),
				generation,
				token
			);
		});
}

export function subscribeToParty(partyId: string, gameId: string | null = null) {
	// Register (or resync) the offline-detection listeners for this session.
	registerOfflineListeners();

	// Bump the generation FIRST so any async CLOSED fired by the unsubscribe() calls
	// below is treated as stale and cannot schedule a reconnect against the old party.
	const generation = ++currentGeneration;

	// Unsubscribe from previous channels and clear reconnect state.
	// IMPORTANT: this must run BEFORE setting up new channels, to cancel any
	// pending reconnect timeouts that might capture stale partyId/gameId.
	teardownChannels();

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
		teardownChannels();
	};
}

// Broadcast a message to other clients
export function broadcast(message: Omit<BroadcastMessage, 'clientId'>) {
	if (!channelStates.broadcast.channel) return;

	channelStates.broadcast.channel.send({
		type: 'broadcast',
		event: 'square_update',
		payload: { ...message, clientId },
	});
}

// Broadcast score update notification to other clients
// A backup to postgres_changes for score entries: added after scores failed to
// reach clients through postgres_changes alone on game night (#64).
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
	teardownChannels();
	unregisterOfflineListeners();
}
