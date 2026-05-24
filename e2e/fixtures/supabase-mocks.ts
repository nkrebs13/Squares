import type { Page } from '@playwright/test';

// ── Default mock data ──

export const mockParty = {
	id: 'test-party-id',
	code: 'TEST1',
	status: 'filling',
	square_price: 5,
	split_q1: 10,
	split_q2: 20,
	split_q3: 30,
	split_final: 40,
	event_name: 'Test Football Squares',
	kickoff_at: null,
	team_row_name: 'Seahawks',
	team_col_name: 'Patriots',
	team_row_color: '#69be28',
	team_col_color: '#c60c30',
	host_name_lower: 'host',
	game_id: null,
	home_team_is_row: true,
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

export function generatePartiallyFilledSquares(
	partyId: string,
	claims: { row: number; col: number; name: string }[]
) {
	const squares = generateEmptySquares(partyId);
	for (const claim of claims) {
		const idx = claim.row * 10 + claim.col;
		squares[idx] = {
			...squares[idx],
			player_name: claim.name,
			player_name_lower: claim.name.toLowerCase(),
		};
	}
	return squares;
}

export function generateFullSquares(partyId: string) {
	const names = ['Alice', 'Bob', 'Charlie', 'Dana', 'Eve'];
	const squares = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			const name = names[(row * 10 + col) % names.length];
			squares.push({
				id: `square-${row}-${col}`,
				party_id: partyId,
				row_num: row,
				col_num: col,
				player_name: name,
				player_name_lower: name.toLowerCase(),
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
	q1_row_score: null,
	q1_col_score: null,
	q2_row_score: null,
	q2_col_score: null,
	q3_row_score: null,
	q3_col_score: null,
	final_row_score: null,
	final_col_score: null,
};

// ── Score / winner data factories ──

export const mockActiveScores = {
	...mockScores,
	q1_row_score: 14,
	q1_col_score: 7,
};

export const mockCompleteScores = {
	...mockScores,
	q1_row_score: 14,
	q1_col_score: 7,
	q2_row_score: 21,
	q2_col_score: 14,
	q3_row_score: 28,
	q3_col_score: 21,
	final_row_score: 31,
	final_col_score: 24,
};

export const mockWinnersQ1 = [
	{
		id: 'winner-q1',
		party_id: 'test-party-id',
		quarter: 'q1',
		winning_row: 4,
		winning_col: 7,
		player_name: 'Alice',
		amount: 50,
		created_at: new Date().toISOString(),
	},
];

export const mockWinnersAll = [
	...mockWinnersQ1,
	{
		id: 'winner-q2',
		party_id: 'test-party-id',
		quarter: 'q2',
		winning_row: 1,
		winning_col: 4,
		player_name: 'Bob',
		amount: 100,
		created_at: new Date().toISOString(),
	},
	{
		id: 'winner-q3',
		party_id: 'test-party-id',
		quarter: 'q3',
		winning_row: 8,
		winning_col: 1,
		player_name: 'Charlie',
		amount: 150,
		created_at: new Date().toISOString(),
	},
	{
		id: 'winner-final',
		party_id: 'test-party-id',
		quarter: 'final',
		winning_row: 1,
		winning_col: 4,
		player_name: 'Dana',
		amount: 200,
		created_at: new Date().toISOString(),
	},
];

// ── Override-based mock setup ──

interface MockOverrides {
	partyOverrides?: Record<string, unknown>;
	squaresData?: ReturnType<typeof generateEmptySquares>;
	scoresOverrides?: Record<string, unknown>;
	winnersData?: typeof mockWinnersAll;
}

export async function setupSupabaseMocksWithOverrides(page: Page, overrides: MockOverrides = {}) {
	const partyData = { ...mockParty, ...overrides.partyOverrides };
	const squaresData = overrides.squaresData ?? generateEmptySquares(partyData.id as string);
	const scoresData = { ...mockScores, ...overrides.scoresOverrides };
	const winnersData = overrides.winnersData ?? [];

	// Mock party lookup by code
	await page.route('**/rest/v1/parties?*code=eq.TEST1*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(partyData),
		});
	});

	// Mock party by ID
	await page.route('**/rest/v1/parties?*id=eq.test-party-id*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify([partyData]),
		});
	});

	// Mock squares
	await page.route('**/rest/v1/squares*', (route) => {
		if (route.request().method() === 'GET') {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(squaresData),
			});
		} else if (route.request().method() === 'POST') {
			route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify(squaresData),
			});
		} else if (route.request().method() === 'PATCH') {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([{ ...squaresData[0], player_name: 'TestPlayer' }]),
			});
		} else {
			route.continue();
		}
	});

	// Mock numbers (returns single object for .single())
	await page.route('**/rest/v1/numbers*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(mockNumbers),
		});
	});

	// Mock scores (returns single object for .single())
	await page.route('**/rest/v1/scores*', (route) => {
		if (route.request().method() === 'POST') {
			route.fulfill({
				status: 201,
				contentType: 'application/json',
				body: JSON.stringify(scoresData),
			});
		} else {
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(scoresData),
			});
		}
	});

	// Mock game score auto-detection/live-score fetches.
	await page.route('**/rest/v1/game_scores*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(null),
		});
	});

	// Mock winners
	await page.route('**/rest/v1/winners*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(winnersData),
		});
	});

	// Mock RPC endpoints
	await page.route('**/rest/v1/rpc/claim_square', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(null),
		});
	});

	await page.route('**/rest/v1/rpc/unclaim_square', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(null),
		});
	});

	await page.route('**/rest/v1/rpc/verify_host_pin', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(true),
		});
	});

	// Mock realtime connections
	await page.route('**/realtime/**', (route) => {
		route.abort();
	});
}

// ── Legacy setup (unchanged API, fixed bugs) ──

export async function setupSupabaseMocks(page: Page) {
	await setupSupabaseMocksWithOverrides(page);
}

// ── IndexedDB seeding for RecentParties ──

interface RecentPartyData {
	code: string;
	teamRowName: string;
	teamColName: string;
	lastVisited: number;
	status: string;
	isHost: boolean;
	nickname?: string;
}

export async function seedRecentParties(page: Page, parties: RecentPartyData[]) {
	await page.evaluate((data) => {
		return new Promise<void>((resolve, reject) => {
			const request = indexedDB.open('keyval-store', 1);
			request.onupgradeneeded = () => {
				const db = request.result;
				if (!db.objectStoreNames.contains('keyval')) {
					db.createObjectStore('keyval');
				}
			};
			request.onsuccess = () => {
				const db = request.result;
				const tx = db.transaction('keyval', 'readwrite');
				const store = tx.objectStore('keyval');
				store.put(data, 'squares_recent_parties');
				tx.oncomplete = () => {
					db.close();
					resolve();
				};
				tx.onerror = () => {
					db.close();
					reject(tx.error);
				};
			};
			request.onerror = () => reject(request.error);
		});
	}, parties);
}

// ── User name helper ──

export async function setUserName(page: Page, name: string) {
	// Navigate to the app origin first so localStorage is accessible
	// (accessing localStorage on about:blank throws a SecurityError)
	await page.goto('/');
	await page.evaluate((userName) => {
		localStorage.setItem('squares_user_name', userName);
	}, name);
}
