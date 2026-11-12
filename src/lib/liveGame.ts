/**
 * The live game's status, from the `game_scores.game_status` column (migration 017)
 * and the ESPN scoreboard API. Known values are listed so a typo in a comparison is
 * a compile error. A new ESPN value fails the realtime validator (validators/realtime.ts):
 * that is the intended observability signal rather than a silent passthrough.
 */
export const GAME_STATUSES = ['pregame', 'in_progress', 'halftime', 'final'] as const;
export type GameStatus = (typeof GAME_STATUSES)[number];

type MaybeStatus = GameStatus | null | undefined;

/** The game has begun (halftime and final count). */
export function isGameStarted(status: MaybeStatus): boolean {
	return status != null && status !== 'pregame';
}

/** The game is under way: begun and not over. */
export function isGameLive(status: MaybeStatus): boolean {
	return isGameStarted(status) && status !== 'final';
}

export function isGameFinal(status: MaybeStatus): boolean {
	return status === 'final';
}

export function isHalftime(status: MaybeStatus): boolean {
	return status === 'halftime';
}
