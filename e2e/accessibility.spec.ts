import { test, expect } from '@playwright/test';

test.describe('Accessibility', () => {
	test('landing page has proper heading hierarchy', async ({ page }) => {
		await page.goto('/');

		const h1 = page.getByRole('heading', { level: 1 });
		await expect(h1).toBeVisible();
		await expect(h1).toContainText(/football squares/i);
	});

	test('create page has proper heading hierarchy', async ({ page }) => {
		await page.goto('/create');

		const h1 = page.getByRole('heading', { level: 1 });
		await expect(h1).toBeVisible();
		await expect(h1).toContainText(/create party/i);
	});

	test('join page has proper heading hierarchy', async ({ page }) => {
		await page.goto('/join');

		const h1 = page.getByRole('heading', { level: 1 });
		await expect(h1).toBeVisible();
		await expect(h1).toContainText(/join party/i);
	});

	test('form inputs have associated labels', async ({ page }) => {
		await page.goto('/create');

		// Price input should have label
		const priceLabel = page.getByText(/price per square/i);
		await expect(priceLabel).toBeVisible();

		// Host name should have label
		const nameLabel = page.getByText(/your name/i);
		await expect(nameLabel).toBeVisible();

		// PIN should have label
		const pinLabel = page.getByText(/choose your pin/i);
		await expect(pinLabel).toBeVisible();
	});

	test('buttons have accessible names', async ({ page }) => {
		await page.goto('/');

		// Create Party button
		const createButton = page.getByRole('link', { name: /create party/i });
		await expect(createButton).toBeVisible();

		// Join Party button
		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeVisible();
	});

	test('links have descriptive text', async ({ page }) => {
		await page.goto('/create');

		// Back link should be accessible
		const backLink = page.getByRole('link', { name: /back/i });
		await expect(backLink).toBeVisible();
	});
});

test.describe('Keyboard Navigation', () => {
	test('can navigate landing page with keyboard', async ({ page }) => {
		await page.goto('/');

		// Tab through interactive elements
		await page.keyboard.press('Tab');

		// First focusable element should be the Create Party link
		const createButton = page.getByRole('link', { name: /create party/i });
		await expect(createButton).toBeFocused();

		// Tab to code input
		await page.keyboard.press('Tab');
		const codeInput = page.getByPlaceholder(/enter party code/i);
		await expect(codeInput).toBeFocused();

		// Tab to join button
		await page.keyboard.press('Tab');
		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeFocused();
	});

	test('can submit join form with Enter key', async ({ page }) => {
		await page.goto('/');

		const codeInput = page.getByPlaceholder(/enter party code/i);
		await codeInput.fill('TEST1');

		// Press Enter to submit
		await page.keyboard.press('Enter');

		await expect(page).toHaveURL('/join?code=TEST1');
	});

	test('can navigate create party form with keyboard', async ({ page }) => {
		await page.goto('/create');

		// Tab through form elements
		await page.keyboard.press('Tab'); // Back link
		await page.keyboard.press('Tab'); // Price input

		const priceInput = page.locator('input[inputmode="decimal"]');
		await expect(priceInput).toBeFocused();
	});
});

test.describe('Mobile Responsiveness', () => {
	test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

	test('landing page is usable on mobile', async ({ page }) => {
		await page.goto('/');

		await expect(page.getByRole('heading', { name: /football squares/i })).toBeVisible();
		await expect(page.getByRole('link', { name: /create party/i })).toBeVisible();
		await expect(page.getByPlaceholder(/enter party code/i)).toBeVisible();
	});

	test('create form is usable on mobile', async ({ page }) => {
		await page.goto('/create');

		await expect(page.getByRole('heading', { name: /create party/i })).toBeVisible();

		// All form sections should be visible
		await expect(page.getByText(/price per square/i)).toBeVisible();
		await expect(page.getByText(/prize split/i)).toBeVisible();
		await expect(page.getByText(/your name/i)).toBeVisible();
	});

	test('preset buttons are tappable on mobile', async ({ page }) => {
		await page.goto('/create');

		// Tap Equal preset
		const equalButton = page.getByRole('button', { name: /equal/i });
		await equalButton.tap();

		// Verify it's selected (has primary button styling)
		await expect(equalButton).toHaveClass(/btn-primary/);
	});
});

test.describe('Visual Regression Prevention', () => {
	test('landing page renders correctly', async ({ page }) => {
		await page.goto('/');

		// Wait for animations to complete
		await page.waitForTimeout(500);

		// Check key visual elements
		await expect(page.locator('.logo-title')).toBeVisible();
		await expect(page.locator('.btn-primary')).toBeVisible();
		await expect(page.locator('.btn-secondary')).toBeVisible();
	});

	test('create page form sections render correctly', async ({ page }) => {
		await page.goto('/create');

		// Check form cards are visible
		const cards = page.locator('.card');
		await expect(cards).toHaveCount(4); // Price, Split, Name, PIN
	});
});
