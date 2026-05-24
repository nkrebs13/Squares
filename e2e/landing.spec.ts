import { test, expect } from '@playwright/test';
import { seedRecentParties } from './fixtures/supabase-mocks';

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

	test('has demo link that opens the seeded demo party join flow', async ({ page }) => {
		const demoLink = page.getByRole('link', { name: /try demo/i });
		await expect(demoLink).toBeVisible();

		await demoLink.click();
		await expect(page).toHaveURL('/join?code=DEMO01');
	});

	test('has Join Party form with code input', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		await expect(codeInput).toBeVisible();

		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeVisible();
		await expect(joinButton).toBeDisabled();
	});

	test('enables Join Party button when a complete code is entered', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('ABCD12');
		await expect(joinButton).toBeEnabled();
	});

	test('navigates to join page with code when Join Party is clicked', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('TEST12');
		await joinButton.click();

		await expect(page).toHaveURL('/join?code=TEST12');
	});

	test('normalizes party code before joining', async ({ page }) => {
		const codeInput = page.getByPlaceholder(/enter party code/i);
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('demo-01');
		await joinButton.click();

		await expect(page).toHaveURL('/join?code=DEMO01');
	});

	test('displays hint about joining multiple parties', async ({ page }) => {
		await expect(page.getByText(/join multiple parties/i)).toBeVisible();
	});

	test('displays production highlights', async ({ page }) => {
		await expect(page.getByText(/live players/i)).toBeVisible();
		await expect(page.getByText(/support requests/i)).toBeVisible();
		await expect(page.getByText(/ci gates/i)).toBeVisible();
	});
});

test.describe('Recent Parties', () => {
	const recentParties = [
		{
			code: 'AAAA1',
			teamRowName: 'Eagles',
			teamColName: 'Chiefs',
			lastVisited: Date.now() - 1000,
			status: 'filling',
			isHost: true,
		},
		{
			code: 'BBBB2',
			teamRowName: 'Rams',
			teamColName: '49ers',
			lastVisited: Date.now() - 2000,
			status: 'active',
			isHost: false,
		},
		{
			code: 'CCCC3',
			teamRowName: 'Bills',
			teamColName: 'Dolphins',
			lastVisited: Date.now() - 3000,
			status: 'complete',
			isHost: false,
		},
	];

	test('shows recent parties when stored', async ({ page }) => {
		// Navigate first so origin is set for IndexedDB access
		await page.goto('/');
		await seedRecentParties(page, recentParties);
		await page.reload();

		await expect(page.getByText(/recent parties/i)).toBeVisible({ timeout: 10000 });
		// Should show party cards
		await expect(page.getByText('AAAA1')).toBeVisible();
		await expect(page.getByText('BBBB2')).toBeVisible();
		await expect(page.getByText('CCCC3')).toBeVisible();
	});

	test('displays team matchup', async ({ page }) => {
		await page.goto('/');
		await seedRecentParties(page, recentParties);
		await page.reload();

		await expect(page.getByText(/recent parties/i)).toBeVisible({ timeout: 10000 });

		// Default display name is "TeamRow vs TeamCol"
		await expect(page.getByText('Eagles vs Chiefs')).toBeVisible();
	});

	test('shows status badges', async ({ page }) => {
		await page.goto('/');
		await seedRecentParties(page, recentParties);
		await page.reload();

		await expect(page.getByText(/recent parties/i)).toBeVisible({ timeout: 10000 });

		// Status badge text mapping: filling->Filling, active->Live, complete->Done
		await expect(page.getByText('Filling')).toBeVisible();
		await expect(page.locator('.status-badge', { hasText: 'Live' })).toBeVisible();
		await expect(page.getByText('Done')).toBeVisible();
	});

	test('clicking navigates to party', async ({ page }) => {
		await page.goto('/');
		await seedRecentParties(page, recentParties);
		await page.reload();

		await expect(page.getByText(/recent parties/i)).toBeVisible({ timeout: 10000 });

		// Click the stretched link (covers the entire card; only pencil/remove buttons are above it)
		await page.locator('.card-nav-link').first().click();

		// Should navigate to the party (or redirect to join since no user name is set)
		await expect(page).toHaveURL(/\/(party|join).*AAAA1/);
	});

	test('remove button removes from list', async ({ page }) => {
		await page.goto('/');
		await seedRecentParties(page, recentParties);
		await page.reload();

		await expect(page.getByText(/recent parties/i)).toBeVisible({ timeout: 10000 });

		// Count initial cards
		const cards = page.locator('.party-card');
		await expect(cards).toHaveCount(3);

		// Click the remove (X) button on the last party card to avoid edit mode interference
		const removeButtons = page.locator('.remove-btn');
		await removeButtons.last().click();

		// Confirm the removal in the inline confirmation
		const confirmBtn = page.getByLabel('Confirm remove');
		await confirmBtn.click();

		// Should have one fewer card
		await expect(cards).toHaveCount(2);
	});
});
