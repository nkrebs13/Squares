import { get, writable, type Readable } from 'svelte/store';
import type {
	RealtimeChannel,
	RealtimePostgresChangesPayload,
	REALTIME_SUBSCRIBE_STATES,
} from '@supabase/supabase-js';
import { getSupabaseClient } from '$lib/supabase';
import { unwatchConnectivity, watchConnectivity } from './connectivity';
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
	error,
	PARTY_NOT_FOUND,
	squares,
	party,
	numbers,
	scores,
	gameScores,
	winners,
	applyWinner,
} from './game-state';
import {
	addPendingOps,
	applySquareUpdate,
	clearSquareFields,
	newPendingOp,
	noteLocalChange,
	rollbackPendingOpIf,
} from './game-pending';
import { normalizePlayerName } from '$lib/utils/playerName';
import { isStaleImage } from '$lib/partyStatus';
import { parseSquareKey } from '$lib/utils/squareKey';

/**
 * Per-channel reconnection state. resetReconnectState() clears the pending
 * reconnectTimeout so a stale closure never fires; teardownChannels() runs it
 * after each unsubscribe.
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
	token: number,
	onSubscribed?: () => void
) {
	// A superseded generation: the async CLOSED after an intentional unsubscribe()
	// must not schedule a reconnect (see currentGeneration).
	if (generation !== currentGeneration) return;

	// A channel the reconnect timer replaced in place keeps the same generation, so
	// its late CLOSED needs the instance token to be told apart from the new one.
	if (token !== channelStates[channelKey].instanceToken) return;

	if (status === 'SUBSCRIBED') {
		resetReconnectState(channelKey);
		onSubscribed?.();
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
	for (const key of Object.keys(channelStates)) dropChannel(key);
}

/** Unsubscribe one channel, drop the reference, cancel its reconnect state. */
function dropChannel(key: string) {
	const state = channelStates[key];
	if (!state.channel) return;
	state.channel.unsubscribe();
	state.channel = null;
	resetReconnectState(key);
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
	if (payload.payload.clientId === clientId) return;

	// Re-fetch scores and winners from the database (source of truth)
	const currentParty = get(party);
	if (!currentParty) return;
	const partyId = currentParty.id;
	// The page may be left, or another party opened, while a refetch is in flight.
	const stillOpen = () => get(party)?.id === partyId;

	const supabase = getSupabaseClient();

	supabase
		.from('scores')
		.select('*')
		.eq('party_id', partyId)
		.single()
		.then(({ data, error }) => {
			if (error) {
				logWarn('[realtime] failed to refetch scores after broadcast:', error.message);
				return;
			}
			if (!stillOpen()) return;
			const parsed = parseScores(data);
			if (!parsed) return;
			noteLocalChange();
			scores.set(parsed);
		});

	supabase
		.from('winners')
		.select('*')
		.eq('party_id', partyId)
		.order('quarter')
		.then(({ data, error }) => {
			if (error) {
				logWarn('[realtime] failed to refetch winners after broadcast:', error.message);
				return;
			}
			if (!stillOpen()) return;
			const parsed = parseWinnerArray(data);
			if (!parsed) return;
			noteLocalChange();
			winners.set(parsed);
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
				// A host action emits an earlier UPDATE (the PIN check resets pin_attempts)
				// before the status change; applied after the action's own result, that older
				// row image would put the party back a stage and remount the next stage's UI.
				if (newParty && !isStaleImage(newParty, get(party))) party.set(newParty);
			} else if (payload.eventType === 'DELETE') {
				// The host deleted the party: say so instead of leaving a live-looking grid.
				const old = payload.old as { id?: string } | null;
				if (old?.id && old.id === get(party)?.id) error.set(PARTY_NOT_FOUND);
			}
		},
	},
	{
		table: 'numbers',
		filterColumn: 'party_id',
		handle: (payload) => {
			if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
				const newNumbers = parseNumbers(payload.new);
				if (newNumbers) numbers.set(newNumbers);
			}
		},
	},
	{
		table: 'scores',
		filterColumn: 'party_id',
		handle: (payload) => {
			if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
				const newScores = parseScores(payload.new);
				if (newScores) scores.set(newScores);
			}
		},
	},
	{
		table: 'winners',
		filterColumn: 'party_id',
		handle: (payload) => {
			// Winners are only ever upserted; a party delete's cascade is not delivered
			// (a DELETE carries only the key, so the party_id filter cannot match it).
			if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
				const newWinner = parseWinner(payload.new);
				if (newWinner) applyWinner(newWinner);
			}
		},
	},
];

/**
 * Called each time the party's postgres_changes channel joins: first subscribe and every
 * rejoin. Events from before a join never arrive, so the caller re-reads the party then.
 */
let onPartyJoined: (() => void) | null = null;

function setupPartyChannel(partyId: string, generation: number) {
	const supabase = getSupabaseClient();
	const token = ++channelStates.party.instanceToken;
	let channel = supabase.channel(`party:${partyId}`);
	for (const { table, filterColumn, handle } of PARTY_TABLE_SUBSCRIPTIONS) {
		channel = channel.on(
			'postgres_changes',
			{ event: '*', schema: 'public', table, filter: `${filterColumn}=eq.${partyId}` },
			(payload) => {
				noteLocalChange();
				handle(payload);
			}
		);
	}
	channelStates.party.channel = channel.subscribe((status) => {
		handleChannelStatus(
			'party',
			status,
			() => setupPartyChannel(partyId, generation),
			generation,
			token,
			() => onPartyJoined?.()
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
				noteLocalChange();
				if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
					const newGameScores = parseGameScores(payload.new);
					if (newGameScores) gameScores.set(newGameScores);
				} else if (payload.eventType === 'DELETE') {
					gameScores.set(null);
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

export function subscribeToParty(
	partyId: string,
	gameId: string | null = null,
	onJoined: (() => void) | null = null
) {
	watchConnectivity();
	onPartyJoined = onJoined;

	// Bump first so the CLOSED from the teardown below is treated as stale.
	const generation = ++currentGeneration;

	// Before setting up new channels, so no pending reconnect timeout captures a stale partyId/gameId.
	teardownChannels();

	setupBroadcastChannel(partyId, generation);
	setupPartyChannel(partyId, generation);

	if (gameId) {
		setupGameChannel(gameId, generation);
	}
}

/**
 * Point the game channel at another game (or none) and leave the party's channels
 * joined, so no square, status or winner event is lost while it switches. A game
 * update missed while the new channel joins heals on the next one (each carries the
 * whole row).
 */
export function followGame(gameId: string | null) {
	// Bump first: the old channel's async CLOSED must not schedule a reconnect.
	++channelStates.game.instanceToken;
	dropChannel('game');
	if (gameId) setupGameChannel(gameId, currentGeneration);
}

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

// Cleanup channels (called from game-session cleanup)
export function cleanupChannels() {
	// Bump so the CLOSED events from this teardown cannot resurrect a subscription.
	++currentGeneration;
	onPartyJoined = null;
	teardownChannels();
	unwatchConnectivity();
}
