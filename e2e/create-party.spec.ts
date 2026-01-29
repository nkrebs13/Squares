import { test, expect } from '@playwright/test';

test.describe('Create Party Page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/create');
	});

	test('displays the create party form', async ({ page }) => {
		await expect(page.getByRole('heading', { name: /create party/i })).toBeVisible();
	});

	test('has back link to home', async ({ page }) => {
		const backLink = page.getByRole('link', { name: /back/i });
		await expect(backLink).toBeVisible();

		await backLink.click();
		await expect(page).toHaveURL('/');
	});

	test('has price per square input with default value', async ({ page }) => {
		const priceLabel = page.getByText(/price per square/i);
		await expect(priceLabel).toBeVisible();

		const priceInput = page.locator('input[inputmode="decimal"]');
		await expect(priceInput).toHaveValue('1');
	});

	test('shows total pot calculation', async ({ page }) => {
		await expect(page.getByText(/total pot/i)).toBeVisible();
		await expect(page.getByText(/\$100/)).toBeVisible();
	});

	test('updates total pot when price changes', async ({ page }) => {
		const priceInput = page.locator('input[inputmode="decimal"]');
		await priceInput.clear();
		await priceInput.fill('5');

		await expect(page.getByText(/\$500/)).toBeVisible();
	});

	test('shows validation error for invalid price', async ({ page }) => {
		const priceInput = page.locator('input[inputmode="decimal"]');
		await priceInput.clear();
		await priceInput.fill('abc');

		await expect(page.getByText(/enter a valid amount/i)).toBeVisible();
	});

	test('has prize split presets', async ({ page }) => {
		await expect(page.getByText(/prize split/i)).toBeVisible();

		// Check preset buttons exist
		await expect(page.getByRole('button', { name: /rising/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /equal/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /big finish/i })).toBeVisible();
		await expect(page.getByRole('button', { name: /custom/i })).toBeVisible();
	});

	test('shows quarter percentages', async ({ page }) => {
		// Default preset should show percentages
		await expect(page.getByText('Q1', { exact: false })).toBeVisible();
		await expect(page.getByText('Q2', { exact: false })).toBeVisible();
		await expect(page.getByText('Q3', { exact: false })).toBeVisible();
		await expect(page.getByText('Final', { exact: false })).toBeVisible();
	});

	test('allows selecting different presets', async ({ page }) => {
		const equalButton = page.getByRole('button', { name: /equal/i });
		await equalButton.click();

		// Equal preset should show 25% for each quarter
		const percentages = page.locator('text=25%');
		await expect(percentages.first()).toBeVisible();
	});

	test('shows custom inputs when Custom preset is selected', async ({ page }) => {
		const customButton = page.getByRole('button', { name: /custom/i });
		await customButton.click();

		// Should show number inputs for custom splits
		const numberInputs = page.locator('input[type="number"]');
		await expect(numberInputs).toHaveCount(4);
	});

	test('shows validation error when custom split does not total 100%', async ({ page }) => {
		const customButton = page.getByRole('button', { name: /custom/i });
		await customButton.click();

		// Change one of the values to make total != 100
		const firstInput = page.locator('input[type="number"]').first();
		await firstInput.clear();
		await firstInput.fill('50');

		await expect(page.getByText(/must total 100%/i)).toBeVisible();
	});

	test('has host name input', async ({ page }) => {
		await expect(page.getByText(/your name/i)).toBeVisible();
		const nameInput = page.getByPlaceholder(/enter your name/i);
		await expect(nameInput).toBeVisible();
	});

	test('has host PIN input', async ({ page }) => {
		await expect(page.getByText(/choose your pin/i)).toBeVisible();
		const pinInput = page.getByPlaceholder('0000');
		await expect(pinInput).toBeVisible();
	});

	test('Create Party button is disabled until form is valid', async ({ page }) => {
		const createButton = page.getByRole('button', { name: /create party/i });
		await expect(createButton).toBeDisabled();
	});

	test('Create Party button is enabled when form is complete', async ({ page }) => {
		// Fill in host name
		const nameInput = page.getByPlaceholder(/enter your name/i);
		await nameInput.fill('Test Host');

		// Fill in PIN
		const pinInput = page.getByPlaceholder('0000');
		await pinInput.fill('1234');

		const createButton = page.getByRole('button', { name: /create party/i });
		await expect(createButton).toBeEnabled();
	});

	test('PIN only accepts 4 digits', async ({ page }) => {
		const pinInput = page.getByPlaceholder('0000');

		// Try typing more than 4 characters
		await pinInput.fill('123456');
		await expect(pinInput).toHaveValue('1234');
	});

	test('host name has max length of 20', async ({ page }) => {
		const nameInput = page.getByPlaceholder(/enter your name/i);

		const longName = 'A'.repeat(25);
		await nameInput.fill(longName);

		const value = await nameInput.inputValue();
		expect(value.length).toBeLessThanOrEqual(20);
	});
});
