import { test, expect, type Page, type TestInfo } from '@playwright/test';
import {
	setupSupabaseMocksWithOverrides,
	mockActiveScores,
	mockCompleteScores,
	mockWinnersAll,
	generatePartiallyFilledSquares,
	setUserName,
} from './fixtures/supabase-mocks';

/**
 * Visual regression baseline for the three party-page UI states.
 *
 * Run for the first time on a fresh checkout:
 *   `npm run test:e2e -- visual.spec.ts --update-snapshots`
 *
 * Subsequent runs compare against the committed PNGs in
 * `e2e/visual.spec.ts-snapshots/`. A diff over the maxDiffPixels
 * threshold (configured in playwright.config.ts) fails the test.
 *
 * If a UI change is intentional, regenerate the baseline with
 * `--update-snapshots` and commit the new PNGs.
 *
 * Today this still uses the mocked Supabase fixtures from
 * setupSupabaseMocksWithOverrides — the mocks deliver deterministic
 * grid contents which is what visual regression needs. The follow-up
 * "real Supabase e2e" pass (Phase 11.2) targets golden-path.spec.ts
 * specifically; visual.spec.ts is happy with mocked data.
 */

/**
 * The first-visit gesture hint covers a filling grid in the mobile layout (and only
 * there); these shots are of the page, so dismiss it the way a visitor would.
 */
async function dismissGestureHint(page: Page, testInfo: TestInfo) {
	if (testInfo.project.name !== 'Mobile Chrome') return;
	const hint = page.getByRole('button', { name: /Tap to dismiss/ });
	await hint.click();
	await expect(hint).toBeHidden();
}

/** Layout depends on web fonts; screenshot only once they have loaded. */
const fontsReady = (page: Page) => page.evaluate(() => document.fonts.ready.then(() => undefined));

test.describe('Visual regression: party page states', () => {
	test('filling state — grid with 5 claimed squares', async ({ page }, testInfo) => {
		await setUserName(page, 'TestPlayer');
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'filling' },
			squaresData: generatePartiallyFilledSquares('test-party-id', [
				{ row: 0, col: 0, name: 'Alice' },
				{ row: 0, col: 1, name: 'Bob' },
				{ row: 1, col: 2, name: 'Charlie' },
				{ row: 2, col: 3, name: 'Dana' },
				{ row: 3, col: 4, name: 'Eve' },
			]),
		});
		await page.goto('/party/TEST12');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });

		await expect(page.locator('.square-claimed')).toHaveCount(5);
		await dismissGestureHint(page, testInfo);
		await fontsReady(page);

		await expect(page).toHaveScreenshot('party-filling.png', { fullPage: true });
	});

	test('active state — numbers visible, scoreboard live', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'active' },
			scoresOverrides: mockActiveScores,
		});
		await page.goto('/party/TEST12');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });
		await expect(page.getByRole('columnheader').first()).toHaveText('0');
		await fontsReady(page);

		await expect(page).toHaveScreenshot('party-active.png', { fullPage: true });
	});

	test('complete state — winners section populated', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'complete' },
			scoresOverrides: mockCompleteScores,
			winnersData: mockWinnersAll,
		});
		await page.goto('/party/TEST12');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });
		await expect(page.locator('.winner-banner')).toHaveCount(4);
		await fontsReady(page);

		await expect(page).toHaveScreenshot('party-complete.png', { fullPage: true });
	});
});
