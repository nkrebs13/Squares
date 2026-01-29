import { test, expect, Page } from '@playwright/test';

// Mock data for a party
const mockParty = {
	id: 'test-party-id',
	code: 'TEST1',
	status: 'filling',
	square_price: 5,
	split_q1: 10,
	split_q2: 20,
	split_q3: 30,
	split_final: 40,
	team_row_name: 'Seahawks',
	team_col_name: 'Patriots',
	team_row_color: '#69be28',
	team_col_color: '#c60c30',
	host_name_lower: 'host',
	expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

// Generate 100 empty squares
const generateEmptySquares = (partyId: string) => {
	const squares = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			squares.push({
				id: `square-${row}-${col}`,
				party_id: partyId,
				row_num: row,
				col_num: col,
				player_name: null,
				player_name_lower: null,
			});
		}
	}
	return squares;
};

// Generate numbers for the grid
const mockNumbers = {
	id: 'numbers-id',
	party_id: 'test-party-id',
	row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

const mockScores = {
	id: 'scores-id',
	party_id: 'test-party-id',
	score_row_q1: null,
	score_col_q1: null,
	score_row_q2: null,
	score_col_q2: null,
	score_row_q3: null,
	score_col_q3: null,
	score_row_final: null,
	score_col_final: null,
};

async function setupSupabaseMocks(page: Page) {
	// Mock party lookup
	await page.route('**/rest/v1/parties?*code=eq.TEST1*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(mockParty),
		});
	});

	// Mock party by ID
	await page.route('**/rest/v1/parties?*id=eq.test-party-id*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([mockParty]),
		});
	});

	// Mock squares
	await page.route('**/rest/v1/squares*', (route) => {
		if (route.request().method() === 'GET') {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(generateEmptySquares('test-party-id')),
			});
		} else if (route.request().method() === 'PATCH') {
			// Mock successful square claim
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{ ...generateEmptySquares('test-party-id')[0], player_name: 'TestPlayer' },
				]),
			});
		} else {
			route.continue();
		}
	});

	// Mock numbers
	await page.route('**/rest/v1/numbers*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([mockNumbers]),
		});
	});

	// Mock scores
	await page.route('**/rest/v1/scores*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([mockScores]),
		});
	});

	// Mock winners
	await page.route('**/rest/v1/winners*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([]),
		});
	});

	// Mock realtime connections (just complete them)
	await page.route('**/realtime/**', (route) => {
		route.abort();
	});
}

async function setUserName(page: Page, name: string) {
	// Navigate to the app origin first so localStorage is accessible
	// (accessing localStorage on about:blank throws a SecurityError)
	await page.goto('/');
	await page.evaluate((userName) => {
		localStorage.setItem('squares_userName', userName);
	}, name);
}

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

		// Should show team names
		await expect(page.getByText(/seahawks/i)).toBeVisible();
		await expect(page.getByText(/patriots/i)).toBeVisible();
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

		// Check for split percentages in the prize info section
		await expect(page.getByText('10%')).toBeVisible();
		await expect(page.getByText('20%')).toBeVisible();
		await expect(page.getByText('30%')).toBeVisible();
		await expect(page.getByText('40%')).toBeVisible();
	});

	test('shows filling status when party is in filling state', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText(/squares filled/i)).toBeVisible();
	});

	test('displays grid legend', async ({ page }) => {
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST1');

		await expect(page.getByText(/available/i)).toBeVisible();
		await expect(page.getByText(/yours/i)).toBeVisible();
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
