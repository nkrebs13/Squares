import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
	});

	test('displays the main heading and tagline', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /football squares/i })).toBeVisible();
		await expect(page.getByText(/super bowl party pools made easy/i)).toBeVisible();
	});

	test('has Create Party button that navigates to create page', async ({ page }) => {
		const createButton = page.getByRole('link', { name: /create party/i });
		await expect(createButton).toBeVisible();

		await createButton.click();
		await expect(page).toHaveURL('/create');
	});

	test('has Join Party form with code input', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		await expect(codeInput).toBeVisible();

		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeVisible();
		await expect(joinButton).toBeDisabled();
	});

	test('enables Join Party button when code is entered', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('ABCD');
		await expect(joinButton).toBeEnabled();
	});

	test('navigates to join page with code when Join Party is clicked', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('TEST1');
		await joinButton.click();

		await expect(page).toHaveURL('/join?code=TEST1');
	});

	test('converts party code to uppercase', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('abcd');
		await joinButton.click();

		await expect(page).toHaveURL('/join?code=ABCD');
	});

	test('displays hint about joining multiple parties', async ({ page }) => {
		await expect(page.getByText(/join multiple parties/i)).toBeVisible();
	});
});
