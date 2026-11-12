// Barrel re-export — all existing imports from '$lib/stores/game' continue working.
// See game-state.ts, game-load.ts, game-pending.ts, game-realtime.ts,
// game-optimistic.ts, game-admin.ts, game-session.ts for implementations.

export {
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	gameHomeIsRow,
	teamTheme,
	isLoading,
	error,
	gridState,
	liveScores,
	leadingSquare,
	filledCount,
	isGridFull,
	mySquares,
	mySquareCount,
	amountOwed,
	playerSummary,
	availableCount,
	selectedPlayerFilter,
	activePlayerFilter,
	squareKey,
} from './game-state';

export { loadParty } from './game-load';

export type { PlayerSummary } from './game-state';

export { pendingOperations } from './game-pending';

export { subscribeToParty, broadcastScoreUpdate, connectionStatus } from './game-realtime';

export { isOffline } from './connectivity';

export {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquaresBatchOptimistic,
} from './game-optimistic';

export {
	lockParty,
	updateScore,
	updatePartyDetails,
	updatePayoutStructure,
	removePlayer,
	deleteParty,
	verifyHostPin,
} from './game-admin';

export { openParty, cleanup } from './game-session';

export type { PartyDetailsInput } from './game-admin';
