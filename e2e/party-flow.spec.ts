import { test, expect } from '@playwright/test';
import {
	setupSupabaseMocks,
	setupSupabaseMocksWithOverrides,
	setUserName,
	generatePartiallyFilledSquares,
	generateFullSquares,
	mockActiveScores,
	mockCompleteScores,
	mockWinnersQ1,
	mockWinnersAll,
} from './fixtures/supabase-mocks';

test.describe('Party Page - Mocked Flow', () => {
	test.beforeEach(async ({ page }) => {
		await setupSupabaseMocks(page);
	});

	test('redirects to join page if no user name is set', async ({ page }) => {
		await page.goto('/party/TEST1');

		await expect(page).toHaveURL('/join?code=TEST1');
	});

	test('displays party page when user name is set', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Should show team names in the heading
		await expect(page.getByRole('heading', { name: /seahawks/i })).toBeVisible();
		await expect(page.getByRole('heading', { name: /patriots/i })).toBeVisible();
	});

	test('displays the 10x10 grid', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Wait for grid to load - look for grid elements
		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });
	});

	test('shows user stats bar', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText(/your squares/i)).toBeVisible();
	});

	test('shows home link', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		const homeLink = page.getByRole('link', { name: /home/i });
		await expect(homeLink).toBeVisible();
	});

	test('displays prize split information', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Prize percentages render in both mobile and desktop sections; verify at least one of each is in the DOM
		await expect(page.getByText('10%').first()).toBeAttached();
		await expect(page.getByText('20%').first()).toBeAttached();
		await expect(page.getByText('30%').first()).toBeAttached();
		await expect(page.getByText('40%').first()).toBeAttached();
	});

	test('shows filling status when party is in filling state', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Status banner renders in both mobile and desktop sections
		await expect(page.getByText(/squares filled/i).first()).toBeAttached();
	});

	test('displays grid legend', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText(/available/i)).toBeVisible();
		await expect(page.getByText(/yours/i)).toBeVisible();
	});
});

test.describe('Party Page - Status States', () => {
	test('shows scoreboard when locked (same as active)', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'locked' },
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Locked now shows ScoreBoard instead of "grid locked" banner
		await expect(page.getByText('Seahawks').first()).toBeAttached();
		await expect(page.getByText('Patriots').first()).toBeAttached();
	});

	test('shows scoreboard when active', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'active' },
			scoresOverrides: mockActiveScores,
			winnersData: mockWinnersQ1,
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Team names should appear in scoreboard
		await expect(page.getByText('Seahawks').first()).toBeAttached();
		await expect(page.getByText('Patriots').first()).toBeAttached();

		// Winners section should render
		await expect(page.getByText(/winners/i).first()).toBeAttached();
		await expect(page.getByText('Alice').first()).toBeAttached();
	});

	test('shows game complete banner', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'complete' },
			scoresOverrides: mockCompleteScores,
			winnersData: mockWinnersAll,
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText(/game complete/i).first()).toBeAttached();

		// All winners should be listed
		await expect(page.getByText('Alice').first()).toBeAttached();
		await expect(page.getByText('Bob').first()).toBeAttached();
		await expect(page.getByText('Charlie').first()).toBeAttached();
		await expect(page.getByText('Dana').first()).toBeAttached();
	});

	test('shows party code share in all statuses', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'locked' },
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Wait for page to load (locked now shows ScoreBoard with team names)
		await expect(page.getByText('Seahawks').first()).toBeAttached();

		// PartyCode component should render in all statuses (including locked)
		await expect(page.getByText('TEST1').first()).toBeAttached();
	});

	test('squares are disabled when party is locked', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'locked' },
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Wait for grid to load
		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });

		// All square buttons should be disabled (non-filling status)
		const squareButtons = page.locator('.grid-11x11 button.square');
		const firstSquare = squareButtons.first();
		await expect(firstSquare).toBeDisabled();
	});
});

test.describe('Square Interactions', () => {
	test('clicking empty square claims it optimistically', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Wait for grid to load
		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });

		// Click first empty square (use the aria-label to find it)
		const emptySquare = page.locator('button.square-empty').first();
		await emptySquare.click();

		// Should show initials optimistically (TE for TestPlayer)
		await expect(page.getByText('TE').first()).toBeAttached({ timeout: 5000 });
	});

	test('own square is clickable (not disabled)', async ({ page }) => {
		const claims = [{ row: 0, col: 0, name: 'TestPlayer' }];
		await setupSupabaseMocksWithOverrides(page, {
			squaresData: generatePartiallyFilledSquares('test-party-id', claims),
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Wait for grid and find our square
		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });
		const mySquare = page.locator('button.square-mine').first();
		await expect(mySquare).toBeAttached();

		// Own square should be enabled (not disabled) so user can unclaim via touch
		await expect(mySquare).toBeEnabled();
	});

	test('cannot click squares claimed by others', async ({ page }) => {
		const claims = [{ row: 0, col: 0, name: 'OtherPerson' }];
		await setupSupabaseMocksWithOverrides(page, {
			squaresData: generatePartiallyFilledSquares('test-party-id', claims),
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });

		// Square claimed by OtherPerson should be disabled
		const otherSquare = page.locator('button.square-claimed').first();
		await expect(otherSquare).toBeDisabled();
	});

	test('cannot click squares when party is locked', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'locked' },
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.locator('.grid-11x11')).toBeVisible({ timeout: 10000 });

		// All squares should be disabled
		const firstSquare = page.locator('button.square').first();
		await expect(firstSquare).toBeDisabled();
	});
});

test.describe('Party Code Sharing', () => {
	test('displays party code', async ({ page }) => {
		await setupSupabaseMocks(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText('TEST1').first()).toBeAttached();
	});

	test('shows Copy Code, Copy Link, and Share buttons', async ({ page }) => {
		await setupSupabaseMocks(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByRole('button', { name: /copy code/i }).first()).toBeAttached();
		await expect(page.getByRole('button', { name: /copy link/i }).first()).toBeAttached();
		await expect(page.getByRole('button', { name: /share/i }).first()).toBeAttached();
	});

	test('Copy Code button shows confirmation', async ({ page }) => {
		await setupSupabaseMocks(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Grant clipboard permissions
		await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

		const copyButton = page.getByRole('button', { name: /copy code/i }).first();
		await copyButton.click();

		await expect(page.getByText('Copied!').first()).toBeAttached({ timeout: 5000 });
	});

	test('QR Code button shows QR code image', async ({ page }) => {
		await setupSupabaseMocks(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		const qrButton = page.getByRole('button', { name: /qr code/i }).first();
		await expect(qrButton).toBeAttached();
		await qrButton.click();

		// QR code should render as an image
		await expect(page.locator('img[alt="QR code to join party"]').first()).toBeVisible({
			timeout: 5000,
		});
	});
});

test.describe('Party Page - Error States', () => {
	test('shows error when party does not exist', async ({ page }) => {
		// Mock party not found
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(null),
			});
		});

		await setUserName(page, 'TestPlayer');

		await page.goto('/party/INVALID');

		// Should show error message and home link
		await expect(page.getByRole('link', { name: /go home/i })).toBeVisible({ timeout: 10000 });
	});

	test('shows error on network failure', async ({ page }) => {
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Internal Server Error' }),
			});
		});

		// Mock realtime connections
		await page.route('**/realtime/**', (route) => {
			route.abort();
		});

		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByRole('link', { name: /go home/i })).toBeVisible({ timeout: 10000 });
	});

	test('partially filled grid shows correct count', async ({ page }) => {
		const claims = [
			{ row: 0, col: 0, name: 'Alice' },
			{ row: 0, col: 1, name: 'Bob' },
			{ row: 0, col: 2, name: 'Charlie' },
			{ row: 0, col: 3, name: 'Dana' },
			{ row: 0, col: 4, name: 'Eve' },
		];
		await setupSupabaseMocksWithOverrides(page, {
			squaresData: generatePartiallyFilledSquares('test-party-id', claims),
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText('5/100').first()).toBeAttached({ timeout: 10000 });
	});

	test('full grid shows ready to lock', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			squaresData: generateFullSquares('test-party-id'),
		});
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText(/ready to lock/i).first()).toBeAttached({ timeout: 10000 });
	});
});

test.describe('Complete User Journey', () => {
	test('user can navigate from landing to join and enter a party', async ({ page }) => {
		// Start at landing page
		await page.goto('/');
		await expect(page.getByRole('heading', { name: /football squares/i })).toBeVisible();

		// Enter party code and click join
		await page.getByPlaceholder(/enter party code/i).fill('TEST1');
		await page.getByRole('button', { name: /join party/i }).click();

		// Should be on join page
		await expect(page).toHaveURL('/join?code=TEST1');
		await expect(page.getByPlaceholder('ABCD12')).toHaveValue('TEST1');

		// Fill in name
		await page.getByPlaceholder(/enter your name/i).fill('TestPlayer');

		// Setup mocks before clicking join
		await setupSupabaseMocks(page);

		// Click join
		await page.getByRole('button', { name: /join party/i }).click();

		// Should navigate to party page
		await expect(page).toHaveURL('/party/TEST1');
	});
});

test.describe('Party Page - OG Meta Tags', () => {
	test('party page has OG meta tags with team names', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		// Wait for page to load
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });

		// Verify OG meta tags (layout has default, party page overrides with team names)
		const ogTitle = page.locator('meta[property="og:title"]').last();
		await expect(ogTitle).toHaveAttribute('content', /Seahawks.*Patriots/);

		const ogDescription = page.locator('meta[property="og:description"]').last();
		await expect(ogDescription).toHaveAttribute('content', /claim your squares/i);
	});
});

test.describe('Party Page - Gesture Hint', () => {
	test.use({ viewport: { width: 375, height: 667 } }); // mobile viewport

	test('gesture hint overlay renders on first mobile visit', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestPlayer');

		// Clear IndexedDB to ensure first-visit behavior
		await page.evaluate(() => indexedDB.deleteDatabase('football-squares'));

		await page.goto('/party/TEST1');

		// Wait for grid to load
		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });

		// GestureHint should be visible on first mobile visit (IndexedDB cleared above)
		await expect(page.locator('.gesture-hint-overlay')).toBeVisible({ timeout: 5000 });
	});
});
