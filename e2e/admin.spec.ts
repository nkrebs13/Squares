import { test, expect } from '@playwright/test';
import {
	setupSupabaseMocksWithOverrides,
	setUserName,
	generateFullSquares,
	mockActiveScores,
	mockCompleteScores,
	mockWinnersAll,
} from './fixtures/supabase-mocks';

/**
 * Helper to set sessionStorage PIN before navigating to admin.
 * Must be called after navigating to a same-origin page.
 */
async function setSessionPin(page: import('@playwright/test').Page, code: string, pin: string) {
	await page.evaluate(
		({ code, pin }) => {
			sessionStorage.setItem(`squares_pin_${code}`, pin);
		},
		{ code, pin }
	);
}

test.describe('Admin Page - PIN Entry', () => {
	test('shows PIN entry when not authorized', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestHost');
		await page.goto('/party/TEST12/admin');

		// PIN input and Verify button should be visible
		await expect(page.getByPlaceholder('0000')).toBeVisible({ timeout: 10000 });
		await expect(page.getByRole('button', { name: /verify/i })).toBeVisible();
	});

	test('Verify button enabled at 4 digits', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestHost');
		await page.goto('/party/TEST12/admin');

		const pinInput = page.getByPlaceholder('0000');
		const verifyButton = page.getByRole('button', { name: /verify/i });

		// Disabled at 3 digits
		await pinInput.fill('123');
		await expect(verifyButton).toBeDisabled();

		// Enabled at 4 digits
		await pinInput.fill('1234');
		await expect(verifyButton).toBeEnabled();
	});

	test('PIN entry grants access', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestHost');
		await page.goto('/party/TEST12/admin');

		// Enter PIN
		await page.getByPlaceholder('0000').fill('1234');
		await page.getByRole('button', { name: /verify/i }).click();

		// Should show the Host Panel heading
		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible();
	});
});

test.describe('Admin Page - Filling Status', () => {
	test.beforeEach(async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page);
		await setUserName(page, 'TestHost');
		// Set session PIN so we're pre-authorized
		await page.goto('/party/TEST12/admin');
		await setSessionPin(page, 'TEST12', '1234');
		await page.reload();
	});

	test('shows filling status with square count', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		// Status shows "filling"
		await expect(page.getByText('filling')).toBeVisible();

		// Square count
		await expect(page.getByText('0/100 squares filled')).toBeVisible();
	});

	test('shows progress bar when grid not full', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		await expect(page.getByText(/grid is not full yet/i)).toBeVisible();
	});

	test('shows Lock button when grid full', async ({ page }) => {
		// Re-setup with full grid
		await setupSupabaseMocksWithOverrides(page, {
			squaresData: generateFullSquares('test-party-id'),
		});
		await page.goto('/party/TEST12/admin');
		await setSessionPin(page, 'TEST12', '1234');
		await page.reload();

		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		await expect(page.getByRole('button', { name: /lock grid/i })).toBeVisible();
	});

	test('shows Danger Zone with Delete button', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		await expect(page.getByText(/danger zone/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /delete party/i })).toBeVisible();
	});

	test('shows delete confirmation on click', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		await page.getByRole('button', { name: /delete party/i }).click();

		await expect(page.getByRole('button', { name: /yes, delete/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /cancel/i })).toBeVisible();
	});

	test('has back link to game page', async ({ page }) => {
		const backLink = page.getByRole('link', { name: /back to game/i });
		await expect(backLink).toBeVisible({ timeout: 10000 });
		await expect(backLink).toHaveAttribute('href', '/party/TEST12');
	});
});

test.describe('Admin Page - Active Status', () => {
	test('shows score entry when active', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'active' },
			scoresOverrides: mockActiveScores,
		});
		await setUserName(page, 'TestHost');
		await page.goto('/party/TEST12/admin');
		await setSessionPin(page, 'TEST12', '1234');
		await page.reload();

		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		// Score inputs and update button should be visible
		await expect(page.getByText(/manual score entry/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /update score/i })).toBeVisible();
	});
});

test.describe('Admin Page - Complete Status', () => {
	test('shows game complete message', async ({ page }) => {
		await setupSupabaseMocksWithOverrides(page, {
			partyOverrides: { status: 'complete' },
			scoresOverrides: mockCompleteScores,
			winnersData: mockWinnersAll,
		});
		await setUserName(page, 'TestHost');
		await page.goto('/party/TEST12/admin');
		await setSessionPin(page, 'TEST12', '1234');
		await page.reload();

		await expect(page.getByRole('heading', { name: /host panel/i })).toBeVisible({
			timeout: 10000,
		});

		await expect(page.getByText(/game complete/i)).toBeVisible();
	});
});
