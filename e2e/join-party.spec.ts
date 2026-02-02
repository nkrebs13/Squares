import { test, expect } from '@playwright/test';
import { setupSupabaseMocks } from './fixtures/supabase-mocks';

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

test.describe('Join Party - Host PIN Challenge', () => {
	test('shows PIN challenge when name matches host', async ({ page }) => {
		// Mock party lookup returning host_name_lower = 'host'
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'test-party-id',
					status: 'filling',
					host_name_lower: 'host',
				}),
			});
		});

		await page.goto('/join?code=TEST1');

		// Enter the host name (matching 'host')
		await page.getByPlaceholder(/enter your name/i).fill('Host');
		await page.getByRole('button', { name: /join party/i }).click();

		// PIN challenge modal should appear
		await expect(page.getByText(/host name protected/i)).toBeVisible({ timeout: 10000 });
		await expect(page.getByText(/enter the host pin/i)).toBeVisible();
	});

	test('correct PIN allows joining', async ({ page }) => {
		// Mock party lookup
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'test-party-id',
					status: 'filling',
					host_name_lower: 'host',
				}),
			});
		});

		// Mock verify_host_pin RPC — returns true
		await page.route('**/rest/v1/rpc/verify_host_pin', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(true),
			});
		});

		// Mock remaining routes for the party page it navigates to
		await setupSupabaseMocks(page);

		await page.goto('/join?code=TEST1');

		await page.getByPlaceholder(/enter your name/i).fill('Host');
		await page.getByRole('button', { name: /join party/i }).click();

		// Wait for PIN challenge
		await expect(page.getByText(/host name protected/i)).toBeVisible({ timeout: 10000 });

		// Enter correct PIN
		await page.locator('input[type="tel"]').last().fill('1234');
		await page.getByRole('button', { name: /verify/i }).click();

		// Should navigate to party page
		await expect(page).toHaveURL('/party/TEST1', { timeout: 10000 });
	});

	test('incorrect PIN shows error', async ({ page }) => {
		// Mock party lookup
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'test-party-id',
					status: 'filling',
					host_name_lower: 'host',
				}),
			});
		});

		// Mock verify_host_pin RPC — returns false
		await page.route('**/rest/v1/rpc/verify_host_pin', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(false),
			});
		});

		await page.goto('/join?code=TEST1');

		await page.getByPlaceholder(/enter your name/i).fill('Host');
		await page.getByRole('button', { name: /join party/i }).click();

		// Wait for PIN challenge
		await expect(page.getByText(/host name protected/i)).toBeVisible({ timeout: 10000 });

		// Enter incorrect PIN
		await page.locator('input[type="tel"]').last().fill('9999');
		await page.getByRole('button', { name: /verify/i }).click();

		// Should show error
		await expect(page.getByText(/incorrect pin/i)).toBeVisible({ timeout: 10000 });
	});

	test('"Use Different Name" cancels challenge', async ({ page }) => {
		// Mock party lookup
		await page.route('**/rest/v1/parties*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'test-party-id',
					status: 'filling',
					host_name_lower: 'host',
				}),
			});
		});

		await page.goto('/join?code=TEST1');

		await page.getByPlaceholder(/enter your name/i).fill('Host');
		await page.getByRole('button', { name: /join party/i }).click();

		// Wait for PIN challenge
		await expect(page.getByText(/host name protected/i)).toBeVisible({ timeout: 10000 });

		// Click "Use Different Name"
		await page.getByRole('button', { name: /use different name/i }).click();

		// Modal should close
		await expect(page.getByText(/host name protected/i)).not.toBeVisible();

		// Name field should be cleared
		await expect(page.getByPlaceholder(/enter your name/i)).toHaveValue('');
	});
});
