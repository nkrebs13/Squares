import { test, expect } from '@playwright/test';
import {
	setupSupabaseMocksWithOverrides,
	mockParty,
	generateEmptySquares,
	generateFullSquares,
	mockScores,
	mockActiveScores,
	mockCompleteScores,
	mockWinnersQ1,
	mockWinnersAll,
	setUserName,
} from './fixtures/supabase-mocks';

test.describe('Golden Path: Create → Join → Play → Win', () => {
	test('complete user journey from create to winner display', async ({ page }) => {
		// ── Step 1: Create party flow ──
		// Mock the POST RPCs needed for party creation
		await page.route('**/rest/v1/parties*', (route) => {
			if (route.request().method() === 'POST') {
				route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify({ ...mockParty, host_pin: '1234' }),
				});
			} else {
				route.continue();
			}
		});

		await page.route('**/rest/v1/squares*', (route) => {
			if (route.request().method() === 'POST') {
				route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify(generateEmptySquares('test-party-id')),
				});
			} else {
				route.continue();
			}
		});

		await page.route('**/rest/v1/scores*', (route) => {
			if (route.request().method() === 'POST') {
				route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify(mockScores),
				});
			} else {
				route.continue();
			}
		});

		// Mock realtime
		await page.route('**/realtime/**', (route) => route.abort());

		await page.goto('/create');
		await expect(page.locator('h1, h2').first()).toBeVisible();

		// ── Step 2: Join party flow ──
		await setUserName(page, 'TestPlayer');

		// Set up full mocks for the party page
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'filling' },
		});

		await page.goto('/party/TEST1');
		// Wait for the grid to load
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({
			timeout: 10000,
		});

		// ── Step 3: Verify grid renders ──
		// The grid should show square elements
		const gridArea = page.locator('.grid-wrapper').first();
		await expect(gridArea).toBeVisible();

		// ── Step 4: Mock active state with numbers ──
		// Re-mock for active party with full grid and scores
		await page.unrouteAll();
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'active' },
			squaresData: generateFullSquares('test-party-id'),
			scoresOverrides: mockActiveScores,
			winnersData: mockWinnersQ1,
		});

		// Mock lock RPC
		await page.route('**/rest/v1/rpc/lock_party', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(true),
			});
		});

		// Mock update_score RPC
		await page.route('**/rest/v1/rpc/update_score', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(true),
			});
		});

		// Reload to get active state
		await page.goto('/party/TEST1');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({
			timeout: 10000,
		});

		// ── Step 5: Verify winner display ──
		// After all scores, check for complete state
		await page.unrouteAll();
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'complete' },
			squaresData: generateFullSquares('test-party-id'),
			scoresOverrides: mockCompleteScores,
			winnersData: mockWinnersAll,
		});

		await page.goto('/party/TEST1');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({
			timeout: 10000,
		});

		// The page should show winner information — verify at least one winner name appears
		const pageContent = await page.textContent('body');
		expect(pageContent).toBeTruthy();

		// Verify winner names from mockWinnersAll are present on the page
		const hasWinnerContent =
			pageContent?.includes('Alice') ||
			pageContent?.includes('Bob') ||
			pageContent?.includes('Charlie') ||
			pageContent?.includes('Dana');
		expect(hasWinnerContent).toBe(true);
	});
});
