import { test, expect } from '@playwright/test';
import {
	setupSupabaseMocksWithOverrides,
	mockActiveScores,
	mockCompleteScores,
	mockWinnersAll,
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

test.describe('Visual regression: party page states', () => {
	test('filling state — grid with 5 claimed squares', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'filling' },
		});
		await page.goto('/party/TEST1');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });

		// Wait a beat so any open animations settle. animations:'disabled' in
		// playwright.config handles CSS transitions; this is for any layout that
		// depends on resize-observer / first-paint timing.
		await page.waitForTimeout(300);

		await expect(page).toHaveScreenshot('party-filling.png', { fullPage: true });
	});

	test('active state — numbers visible, scoreboard live', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'active' },
			scoresOverrides: mockActiveScores,
		});
		await page.goto('/party/TEST1');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(300);

		await expect(page).toHaveScreenshot('party-active.png', { fullPage: true });
	});

	test('complete state — winners section populated', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'complete' },
			scoresOverrides: mockCompleteScores,
			winnersOverrides: mockWinnersAll,
		});
		await page.goto('/party/TEST1');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });
		await page.waitForTimeout(300);

		await expect(page).toHaveScreenshot('party-complete.png', { fullPage: true });
	});
});
