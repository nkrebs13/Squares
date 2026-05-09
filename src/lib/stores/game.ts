// Barrel re-export — all existing imports from '$lib/stores/game' continue working.
// See game-state.ts, game-realtime.ts, game-optimistic.ts, game-admin.ts for implementations.

export {
	// Core stores
	party,
	squares,
	numbers,
	scores,
	winners,
	gameScores,
	isLoading,
	error,
	// Derived stores
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
	// Pending operations
	pendingOperations,
	// Functions
	loadParty,
	// Utilities
	squareKey,
} from './game-state';

export type { PlayerSummary } from './game-state';

export { subscribeToParty, broadcastScoreUpdate, connectionStatus } from './game-realtime';

export {
	claimSquareOptimistic,
	unclaimSquareOptimistic,
	claimSquaresBatchOptimistic,
} from './game-optimistic';

export {
	lockParty,
	updateScore,
	updatePayoutStructure,
	removePlayer,
	deleteParty,
	cleanup,
	verifyHostPin,
} from './game-admin';
