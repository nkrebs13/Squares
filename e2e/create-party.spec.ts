import { test, expect } from '@playwright/test';

test.describe('Create Party Page', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/create');
		await expect(page.locator('form[data-ready="true"]')).toBeVisible();
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

	test('has event details for future games', async ({ page }) => {
		await expect(page.getByLabel(/event name/i)).toBeVisible();
		await expect(page.getByPlaceholder(/2027 Super Bowl/i)).toBeVisible();
		await expect(page.getByLabel(/kickoff time/i)).toBeVisible();
		await expect(page.getByText(/timezone:/i)).toBeVisible();
	});

	test('applies NFL team presets', async ({ page }) => {
		await page.getByLabel('Left team NFL preset').selectOption('bal');
		await page.getByLabel('Top team NFL preset').selectOption('det');

		await expect(page.getByRole('textbox', { name: 'Left Team', exact: true })).toHaveValue(
			'Ravens'
		);
		await expect(page.getByRole('textbox', { name: 'Top Team', exact: true })).toHaveValue('Lions');
	});

	test('previews and swaps matchup orientation', async ({ page }) => {
		await page.getByLabel('Left team NFL preset').selectOption('bal');
		await page.getByLabel('Top team NFL preset').selectOption('det');

		await expect(page.getByText('Matchup preview')).toBeVisible();
		await expect(page.getByText('Ravens vs Lions')).toBeVisible();

		await page.getByRole('button', { name: 'Swap' }).click();

		await expect(page.getByRole('textbox', { name: 'Left Team', exact: true })).toHaveValue(
			'Lions'
		);
		await expect(page.getByRole('textbox', { name: 'Top Team', exact: true })).toHaveValue(
			'Ravens'
		);
		await expect(page.getByLabel('Left team NFL preset')).toHaveValue('det');
		await expect(page.getByLabel('Top team NFL preset')).toHaveValue('bal');
		await expect(page.getByText('Lions vs Ravens')).toBeVisible();
	});

	test('previews kickoff time with timezone context', async ({ page }) => {
		await page.getByLabel(/kickoff time/i).fill('2027-02-14T15:30');

		await expect(page.getByText(/kickoff:/i)).toBeVisible();
	});

	test('shows total pot calculation', async ({ page }) => {
		await expect(page.getByText(/total pot/i)).toBeVisible();
		await expect(page.getByText('Total pot: $100')).toBeVisible();
	});

	test('updates total pot when price changes', async ({ page }) => {
		const priceInput = page.locator('input[inputmode="decimal"]');
		await priceInput.clear();
		await priceInput.fill('5');

		await expect(page.getByText('Total pot: $500')).toBeVisible();
	});

	test('previews payout amounts from price and split', async ({ page }) => {
		await expect(page.getByTestId('create-payout-preview')).toContainText('Pot $100');
		await expect(page.getByTestId('create-payout-q1')).toContainText('$10');
		await expect(page.getByTestId('create-payout-q2')).toContainText('$20');
		await expect(page.getByTestId('create-payout-q3')).toContainText('$30');
		await expect(page.getByTestId('create-payout-final')).toContainText('$40');

		const priceInput = page.locator('input[inputmode="decimal"]');
		await priceInput.clear();
		await priceInput.fill('5');

		await expect(page.getByTestId('create-payout-preview')).toContainText('Pot $500');
		await expect(page.getByTestId('create-payout-q1')).toContainText('$50');
		await expect(page.getByTestId('create-payout-final')).toContainText('$200');

		await page.getByRole('button', { name: /equal/i }).click();

		await expect(page.getByTestId('create-payout-q1')).toContainText('$125');
		await expect(page.getByTestId('create-payout-final')).toContainText('$125');
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
		await expect(page.locator('label[for="split-q1"]')).toHaveText('Q1');
		await expect(page.locator('label[for="split-q2"]')).toHaveText('Q2');
		await expect(page.locator('label[for="split-q3"]')).toHaveText('Q3');
		await expect(page.locator('label[for="split-final"]')).toHaveText('Final');
	});

	test('allows selecting different presets', async ({ page }) => {
		const equalButton = page.getByRole('button', { name: /equal/i });
		await expect(page.getByText('10%').first()).toBeVisible();
		await page.waitForTimeout(100);
		await equalButton.click();

		// Equal preset should show 25% for each quarter
		await expect(page.getByText('25%').first()).toBeVisible();
	});

	test('shows custom inputs when Custom preset is selected', async ({ page }) => {
		const customButton = page.getByRole('button', { name: /custom/i });
		await customButton.scrollIntoViewIfNeeded();
		await customButton.click();

		// Should show number inputs for custom splits
		const numberInputs = page.locator('input[type="number"]');
		await expect(numberInputs).toHaveCount(4);
	});

	test('shows validation error when custom split does not total 100%', async ({ page }) => {
		const customButton = page.getByRole('button', { name: /custom/i });
		await customButton.scrollIntoViewIfNeeded();
		await customButton.click();

		// Wait for custom inputs to appear
		const firstInput = page.locator('input[type="number"]').first();
		await expect(firstInput).toBeVisible();

		// Change one of the values to make total != 100
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

	test('has optional game nickname field', async ({ page }) => {
		await expect(page.getByText(/game nickname/i)).toBeVisible();
		const nicknameInput = page.getByPlaceholder(/work pool/i);
		await expect(nicknameInput).toBeVisible();
		await expect(page.getByText(/helps you tell games apart/i)).toBeVisible();
	});

	test('game nickname has max length of 30', async ({ page }) => {
		const nicknameInput = page.getByPlaceholder(/work pool/i);
		const longName = 'A'.repeat(35);
		await nicknameInput.fill(longName);
		const value = await nicknameInput.inputValue();
		expect(value.length).toBeLessThanOrEqual(30);
	});

	test('Create Party button is enabled without nickname', async ({ page }) => {
		// Fill in only required fields (name + PIN), leave nickname empty
		await page.getByPlaceholder(/enter your name/i).fill('Test Host');
		await page.getByPlaceholder('0000').fill('1234');

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

test.describe('Create Party - Submission', () => {
	test('valid form creates party and navigates', async ({ page }) => {
		await page.goto('/create');

		// Fill in form
		await page.getByPlaceholder(/enter your name/i).fill('Test Host');
		await page.getByPlaceholder('0000').fill('1234');

		await page.route('**/rest/v1/rpc/create_party', async (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'new-party-id',
					code: 'XTEST1',
					status: 'filling',
					square_price: 1,
					split_q1: 10,
					split_q2: 20,
					split_q3: 30,
					split_final: 40,
					event_name: 'Football Squares',
					kickoff_at: null,
					team_row_name: 'Seahawks',
					team_col_name: 'Patriots',
					team_row_color: '#69be28',
					team_col_color: '#c60c30',
					host_name_lower: 'test host',
					created_at: new Date().toISOString(),
					updated_at: new Date().toISOString(),
					expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
					game_id: null,
					home_team_is_row: true,
				}),
			});
		});

		await page.route('**/rest/v1/squares*', (route) => {
			route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify([]),
			});
		});

		await page.route('**/rest/v1/scores*', (route) => {
			route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify({ party_id: 'new-party-id' }),
			});
		});

		await page.route('**/rest/v1/numbers*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(null),
			});
		});

		await page.route('**/rest/v1/winners*', (route) => {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([]),
			});
		});

		await page.route('**/realtime/**', (route) => {
			route.abort();
		});

		// Click create
		await page.getByRole('button', { name: /create party/i }).click();

		// Should navigate to /party/{code}
		await expect(page).toHaveURL(/\/party\/[A-Z0-9]{6}/, { timeout: 15000 });
	});

	test('shows error on creation failure', async ({ page }) => {
		await page.goto('/create');

		// Fill in form
		await page.getByPlaceholder(/enter your name/i).fill('Test Host');
		await page.getByPlaceholder('0000').fill('1234');

		// Mock party creation failure — target the RPC endpoint used by createPartyService
		await page.route('**/rest/v1/rpc/create_party', (route) => {
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ message: 'Failed to create party. Please try again.' }),
			});
		});

		await page.getByRole('button', { name: /create party/i }).click();

		// Should show error message (could be the raw error or generic message)
		await expect(page.getByText(/something went wrong|failed|duplicate/i)).toBeVisible({
			timeout: 10000,
		});
	});

	test('button shows loading state during submit', async ({ page }) => {
		await page.goto('/create');

		// Fill in form
		await page.getByPlaceholder(/enter your name/i).fill('Test Host');
		await page.getByPlaceholder('0000').fill('1234');

		// Mock with delay to see loading state
		await page.route('**/rest/v1/rpc/create_party', async (route) => {
			await new Promise((r) => setTimeout(r, 2000));
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					id: 'new-party-id',
					code: 'XTEST1',
					status: 'filling',
				}),
			});
		});

		await page.getByRole('button', { name: /create party/i }).click();

		// Button should show loading text
		await expect(page.getByText(/creating/i)).toBeVisible({ timeout: 5000 });
	});
});
