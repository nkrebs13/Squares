import { test, expect } from '@playwright/test';
import {
	mockParty,
	generateEmptySquares,
	generateFullSquares,
	mockScores,
	mockNumbers,
	mockActiveScores,
	mockCompleteScores,
	mockWinnersQ1,
	mockWinnersAll,
	setUserName,
} from './fixtures/supabase-mocks';

test.describe('Golden Path: Create → Join → Play → Win', () => {
	test('complete user journey from create to winner display', async ({ page }) => {
		let partyData = { ...mockParty, status: 'filling' };
		let squaresData = generateEmptySquares('test-party-id');
		let scoresData = mockScores;
		let winnersData: typeof mockWinnersAll = [];

		await page.route('**/rest/v1/parties*', (route) => {
			if (route.request().method() === 'POST') {
				route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify({ ...mockParty, host_pin: '1234' }),
				});
				return;
			}

			const url = new URL(route.request().url());
			const isLookupByCode = url.searchParams.get('code') === `eq.${partyData.code}`;
			const isLookupById = url.searchParams.get('id') === `eq.${partyData.id}`;

			if (!isLookupByCode && !isLookupById) {
				route.continue();
				return;
			}

			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(isLookupById ? [partyData] : partyData),
			});
		});

		await page.route('**/rest/v1/squares*', (route) => {
			if (route.request().method() === 'POST') {
				route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify(squaresData),
				});
				return;
			}

			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(squaresData),
			});
		});

		await page.route('**/rest/v1/scores*', (route) => {
			if (route.request().method() === 'POST') {
				route.fulfill({
					status: 201,
					contentType: 'application/json',
					body: JSON.stringify(scoresData),
				});
				return;
			}

			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(scoresData),
			});
		});

		await page.route('**/rest/v1/numbers*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(mockNumbers),
			});
		});

		await page.route('**/rest/v1/game_scores*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(null),
			});
		});

		await page.route('**/rest/v1/winners*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(winnersData),
			});
		});

		await page.route('**/realtime/**', (route) => route.abort());

		// ── Step 1: Create party flow ──
		await page.goto('/create');
		await expect(page.locator('h1, h2').first()).toBeVisible();

		// ── Step 2: Join party flow ──
		await setUserName(page, 'TestPlayer');

		await page.goto('/party/TEST12');
		// Wait for the grid to load
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({
			timeout: 10000,
		});

		// ── Step 3: Verify grid renders ──
		// The grid should show square elements
		const gridArea = page.locator('.grid-wrapper').first();
		await expect(gridArea).toBeVisible();

		// ── Step 4: Mock active state with numbers ──
		partyData = { ...partyData, status: 'active' };
		squaresData = generateFullSquares('test-party-id');
		scoresData = mockActiveScores;
		winnersData = mockWinnersQ1;

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
		await page.goto('/party/TEST12');
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({
			timeout: 10000,
		});

		// ── Step 5: Verify winner display ──
		// After all scores, check for complete state
		partyData = { ...partyData, status: 'complete' };
		scoresData = mockCompleteScores;
		winnersData = mockWinnersAll;

		await page.goto('/party/TEST12');
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
