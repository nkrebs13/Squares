import { test, expect } from '@playwright/test';
import { setupSupabaseMocks, setUserName } from './fixtures/supabase-mocks';

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
