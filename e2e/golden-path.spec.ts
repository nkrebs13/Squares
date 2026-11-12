import { test, expect } from '@playwright/test';
import {
	mockParty,
	generateEmptySquares,
	generateFullSquares,
	mockScores,
	mockCompleteScores,
	mockWinnersAll,
	mockPartyState,
	setUserName,
	partyStateBody,
} from './fixtures/supabase-mocks';

test.describe('Golden path', () => {
	test('claim a square while filling; a complete party lists its winners in order', async ({
		page,
	}) => {
		await page.route('**/realtime/**', (route) => route.abort());
		await setUserName(page, 'TestPlayer');

		// ── Filling: tapping an empty square sends the claim and shows the player ──
		await mockPartyState(
			page,
			partyStateBody(mockParty, generateEmptySquares(mockParty.id), mockScores)
		);
		let claimedCells: unknown;
		let claimedBy: unknown;
		await page.route('**/rest/v1/rpc/claim_squares', (route) => {
			const body = route.request().postDataJSON() as {
				p_player_name: string;
				p_cells: unknown;
			};
			// Captured, not asserted here: a throw inside a route handler does not fail the test.
			claimedBy = body.p_player_name;
			claimedCells = body.p_cells;
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, claimed: body.p_cells, taken: [] }),
			});
		});

		await page.goto('/party/TEST12');
		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });
		await expect(page.locator('.winner-banner')).toHaveCount(0);

		await page.locator('button.square-empty').first().click();
		await expect(page.locator('button.square-mine')).toHaveCount(1);
		await expect.poll(() => claimedCells).toEqual([{ row: 0, col: 0 }]);
		expect(claimedBy).toBe('TestPlayer');

		// ── Complete: the server now reports scores and every winner ──
		await page.unroute('**/rest/v1/rpc/get_party_state');
		await mockPartyState(
			page,
			partyStateBody(
				{ ...mockParty, status: 'complete' },
				generateFullSquares(mockParty.id),
				mockCompleteScores,
				mockWinnersAll
			)
		);
		await page.goto('/party/TEST12');

		const banners = page.locator('.winner-banner');
		await expect(banners).toHaveCount(4);
		for (const [i, name] of ['Alice', 'Bob', 'Charlie', 'Dana'].entries()) {
			await expect(banners.nth(i)).toContainText(name);
		}
		await expect(banners.last()).toContainText('$200');
	});
});
