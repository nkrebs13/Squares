import { test, expect } from '@playwright/test';

test.describe('Join Party Page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/join');
	});

	test('displays the join party form', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /join party/i })).toBeVisible();
	});

	test('has back link to home', async ({ page }) => {
		const backLink = page.getByRole('link', { name: /back/i });
		await expect(backLink).toBeVisible();

		await backLink.click();
		await expect(page).toHaveURL('/');
	});

	test('has party code input', async ({ page }) => {
		await expect(page.getByText(/party code/i)).toBeVisible();
		const codeInput = page.getByPlaceholder('ABCD12');
		await expect(codeInput).toBeVisible();
	});

	test('has name input', async ({ page }) => {
		await expect(page.getByText(/your name/i)).toBeVisible();
		const nameInput = page.getByPlaceholder(/enter your name/i);
		await expect(nameInput).toBeVisible();
	});

	test('shows hint about using same name', async ({ page }) => {
		await expect(page.getByText(/use the same name/i)).toBeVisible();
	});

	test('Join Party button is disabled until form is filled', async ({ page }) => {
		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeDisabled();
	});

	test('Join Party button is enabled when code and name are provided', async ({ page }) => {
		const codeInput = page.getByPlaceholder('ABCD12');
		await codeInput.fill('TEST1');

		const nameInput = page.getByPlaceholder(/enter your name/i);
		await nameInput.fill('Test Player');

		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeEnabled();
	});

	test('pre-fills code from URL query parameter', async ({ page }) => {
		await page.goto('/join?code=XYZ99');

		const codeInput = page.getByPlaceholder('ABCD12');
		await expect(codeInput).toHaveValue('XYZ99');
	});

	test('converts party code to uppercase', async ({ page }) => {
		const codeInput = page.getByPlaceholder('ABCD12');
		await codeInput.fill('abcd');

		// The input should display uppercase
		await expect(codeInput).toHaveClass(/uppercase/);
	});

	test('party code has max length of 6', async ({ page }) => {
		const codeInput = page.getByPlaceholder('ABCD12');

		await codeInput.fill('ABCDEFGH');
		const value = await codeInput.inputValue();
		expect(value.length).toBeLessThanOrEqual(6);
	});

	test('name has max length of 20', async ({ page }) => {
		const nameInput = page.getByPlaceholder(/enter your name/i);

		const longName = 'A'.repeat(25);
		await nameInput.fill(longName);

		const value = await nameInput.inputValue();
		expect(value.length).toBeLessThanOrEqual(20);
	});
});

test.describe('Join Party Page - With Mocked Supabase', () => {
	test('shows error when party is not found', async ({ page }) => {
		// Mock Supabase response for party not found
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(null),
			});
		});

		await page.goto('/join');

		const codeInput = page.getByPlaceholder('ABCD12');
		await codeInput.fill('XXXXX');

		const nameInput = page.getByPlaceholder(/enter your name/i);
		await nameInput.fill('Test Player');

		const joinButton = page.getByRole('button', { name: /join party/i });
		await joinButton.click();

		await expect(page.getByText(/party not found/i)).toBeVisible();
	});
});
