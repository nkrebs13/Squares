import { describe, it, expect } from 'vitest';
import { GAME_STATUSES, isGameFinal, isGameLive, isGameStarted, isHalftime } from '$lib/liveGame';

describe('live game status', () => {
	it('classifies every status', () => {
		expect(GAME_STATUSES.filter(isGameStarted)).toEqual(['in_progress', 'halftime', 'final']);
		expect(GAME_STATUSES.filter(isGameLive)).toEqual(['in_progress', 'halftime']);
		expect(GAME_STATUSES.filter(isGameFinal)).toEqual(['final']);
		expect(GAME_STATUSES.filter(isHalftime)).toEqual(['halftime']);
	});

	it('treats a missing status as none of them', () => {
		for (const status of [null, undefined]) {
			expect(
				isGameStarted(status) || isGameLive(status) || isGameFinal(status) || isHalftime(status)
			).toBe(false);
		}
	});
});
