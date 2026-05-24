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

	test('Join Party button is enabled without nickname', async ({ page }) => {
		await page.getByPlaceholder('ABCD12').fill('TEST12');
		await page.getByPlaceholder(/enter your name/i).fill('Test Player');

		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeEnabled();
	});

	test('Join Party button is disabled until form is filled', async ({ page }) => {
		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeDisabled();
	});

	test('Join Party button is enabled when code and name are provided', async ({ page }) => {
		const codeInput = page.getByPlaceholder('ABCD12');
		await codeInput.fill('TEST12');

		const nameInput = page.getByPlaceholder(/enter your name/i);
		await nameInput.fill('Test Player');

		const joinButton = page.getByRole('button', { name: /join party/i });
		await expect(joinButton).toBeEnabled();
	});

	test('pre-fills code from URL query parameter', async ({ page }) => {
		await page.goto('/join?code=xyz-999');

		const codeInput = page.getByPlaceholder('ABCD12');
		await expect(codeInput).toHaveValue('XYZ999');
	});

	test('accepts pasted party code separators', async ({ page }) => {
		const codeInput = page.getByPlaceholder('ABCD12');
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('demo-01');
		await page.getByPlaceholder(/enter your name/i).fill('Test Player');

		await expect(joinButton).toBeEnabled();
	});

	test('accepts pasted party code prefixes longer than 6 characters', async ({ page }) => {
		const codeInput = page.getByPlaceholder('ABCD12');
		const joinButton = page.getByRole('button', { name: /join party/i });

		await codeInput.fill('ABCDEFGH');
		await page.getByPlaceholder(/enter your name/i).fill('Test Player');

		await expect(joinButton).toBeEnabled();
	});

	test('name has max length of 20', async ({ page }) => {
		const nameInput = page.getByPlaceholder(/enter your name/i);

		const longName = 'A'.repeat(25);
		await nameInput.fill(longName);

		const value = await nameInput.inputValue();
		expect(value.length).toBeLessThanOrEqual(20);
	});
});

test.describe('Join Party - Nickname Flow', () => {
	test('nickname is stored and shown in recent parties', async ({ page }) => {
		await setupSupabaseMocks(page);

		// Mock party lookup
		await page.route('**/rest/v1/parties*', (route) => {
			if (route.request().method() === 'GET') {
				route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						id: 'test-party-id',
						code: 'NICK12',
						status: 'filling',
						square_price: 5,
						split_q1: 10,
						split_q2: 20,
						split_q3: 30,
						split_final: 40,
						event_name: 'Office Pool',
						kickoff_at: null,
						team_row_name: 'Eagles',
						team_col_name: 'Chiefs',
						team_row_color: '#004c54',
						team_col_color: '#e31837',
						host_name_lower: 'host',
						game_id: null,
						home_team_is_row: true,
						expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
					}),
				});
			} else {
				route.continue();
			}
		});

		await page.goto('/join?code=NICK12');

		// Fill in name and nickname
		await page.getByPlaceholder(/enter your name/i).fill('Player');
		await page.getByPlaceholder(/work pool/i).fill('Office Pool');

		await page.getByRole('button', { name: /join party/i }).click();

		// Wait for party page to fully load
		await expect(page.getByRole('heading', { name: 'Office Pool' })).toBeVisible({
			timeout: 10000,
		});

		// Wait for saveToRecentParties() IDB write to complete before navigating away.
		// The heading renders when $party is set inside loadParty(), but
		// saveToRecentParties() is the next awaited call in onMount — a full-page
		// navigation via page.goto() could abort the in-flight IDB transaction.
		await page.waitForFunction(
			() =>
				new Promise((resolve) => {
					const req = indexedDB.open('keyval-store', 1);
					req.onsuccess = () => {
						const db = req.result;
						const tx = db.transaction('keyval', 'readonly');
						const store = tx.objectStore('keyval');
						const get = store.get('squares_recent_parties');
						get.onsuccess = () => {
							const parties = get.result;
							resolve(
								Array.isArray(parties) &&
									parties.some((p: { nickname?: string }) => p.nickname === 'Office Pool')
							);
						};
						get.onerror = () => resolve(false);
					};
					req.onerror = () => resolve(false);
				}),
			null,
			{ timeout: 10000 }
		);

		// Navigate home and check recent parties shows the nickname
		await page.goto('/');
		await expect(page.getByText('Office Pool')).toBeVisible({ timeout: 10000 });
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
		await codeInput.fill('NOT123');

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

		await page.goto('/join?code=TEST12');

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

		await page.goto('/join?code=TEST12');

		await page.getByPlaceholder(/enter your name/i).fill('Host');
		await page.getByRole('button', { name: /join party/i }).click();

		// Wait for PIN challenge
		await expect(page.getByText(/host name protected/i)).toBeVisible({ timeout: 10000 });

		// Enter correct PIN
		await page.locator('input[type="tel"]').last().fill('1234');
		await page.getByRole('button', { name: /verify/i }).click();

		// Should navigate to party page
		await expect(page).toHaveURL('/party/TEST12', { timeout: 10000 });
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

		await page.goto('/join?code=TEST12');

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

		await page.goto('/join?code=TEST12');

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
