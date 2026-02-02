import type { Page } from '@playwright/test';

export const mockParty = {
	id: 'test-party-id',
	code: 'TEST1',
	status: 'filling',
	square_price: 5,
	split_q1: 10,
	split_q2: 20,
	split_q3: 30,
	split_final: 40,
	team_row_name: 'Seahawks',
	team_col_name: 'Patriots',
	team_row_color: '#69be28',
	team_col_color: '#c60c30',
	host_name_lower: 'host',
	expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
};

export function generateEmptySquares(partyId: string) {
	const squares = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			squares.push({
				id: `square-${row}-${col}`,
				party_id: partyId,
				row_num: row,
				col_num: col,
				player_name: null,
				player_name_lower: null,
			});
		}
	}
	return squares;
}

export const mockNumbers = {
	id: 'numbers-id',
	party_id: 'test-party-id',
	row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
};

export const mockScores = {
	id: 'scores-id',
	party_id: 'test-party-id',
	score_row_q1: null,
	score_col_q1: null,
	score_row_q2: null,
	score_col_q2: null,
	score_row_q3: null,
	score_col_q3: null,
	score_row_final: null,
	score_col_final: null,
};

export async function setupSupabaseMocks(page: Page) {
	// Mock party lookup
	await page.route('**/rest/v1/parties?*code=eq.TEST1*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(mockParty),
		});
	});

	// Mock party by ID
	await page.route('**/rest/v1/parties?*id=eq.test-party-id*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([mockParty]),
		});
	});

	// Mock squares
	await page.route('**/rest/v1/squares*', (route) => {
		if (route.request().method() === 'GET') {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(generateEmptySquares('test-party-id')),
			});
		} else if (route.request().method() === 'PATCH') {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{ ...generateEmptySquares('test-party-id')[0], player_name: 'TestPlayer' },
				]),
			});
		} else {
			route.continue();
		}
	});

	// Mock numbers
	await page.route('**/rest/v1/numbers*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([mockNumbers]),
		});
	});

	// Mock scores
	await page.route('**/rest/v1/scores*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([mockScores]),
		});
	});

	// Mock winners
	await page.route('**/rest/v1/winners*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([]),
		});
	});

	// Mock realtime connections (just complete them)
	await page.route('**/realtime/**', (route) => {
		route.abort();
	});
}

export async function setUserName(page: Page, name: string) {
	// Navigate to the app origin first so localStorage is accessible
	// (accessing localStorage on about:blank throws a SecurityError)
	await page.goto('/');
	await page.evaluate((userName) => {
		localStorage.setItem('squares_user_name', userName);
	}, name);
}
