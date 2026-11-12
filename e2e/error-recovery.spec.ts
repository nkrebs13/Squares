import { test, expect } from '@playwright/test';
import {
	mockPartyState,
	setUserName,
	setupSupabaseMocksWithOverrides,
} from './fixtures/supabase-mocks';

test.describe('Error Recovery', () => {
	test('navigate to nonexistent party shows error', async ({ page }) => {
		// Mock realtime
		await page.route('**/realtime/**', (route) => route.abort());

		// get_party_state returns null for an unknown code
		await mockPartyState(page, null);

		await setUserName(page, 'TestPlayer');
		await page.goto('/party/BADCODE');

		await expect(page.getByText('Party not found')).toBeVisible({ timeout: 10000 });
		await expect(page.getByRole('link', { name: /go home/i })).toBeVisible();
		await expect(page.locator('.grid-wrapper')).toHaveCount(0);
	});

	test('join page handles invalid code gracefully', async ({ page }) => {
		await page.context().route('**/rest/v1/rpc/get_party_preview', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(null),
			});
		});

		await page.goto('/join');
		await page.getByPlaceholder('ABCD12').fill('NOPE99');

		await expect(page.getByText('No party found for this code.')).toBeVisible();
	});

	test('nonexistent route shows SvelteKit error page', async ({ page }) => {
		await page.goto('/nonexistent-page-that-does-not-exist');

		// Our custom +error.svelte should render with "Something went wrong" or a 404 message
		await expect(
			page
				.getByText(/something went wrong/i)
				.or(page.getByText(/not found/i))
				.first()
		).toBeVisible({ timeout: 10000 });

		// Should have a home link
		await expect(page.getByRole('link', { name: /home/i })).toBeVisible();
	});
});

test.describe('Error Boundary', () => {
	test('party page renders the grid with no error fallback', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestPlayer');
		await page.goto('/party/TEST12');

		await expect(page.locator('.grid-wrapper').first()).toBeVisible({ timeout: 10000 });
		await expect(
			page.getByRole('heading', { name: /not found|something went wrong/i })
		).toHaveCount(0);
	});
});
