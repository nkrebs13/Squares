import type { Page } from '@playwright/test';

// ── Default mock data ──

export const mockParty = {
	id: 'test-party-id',
	code: 'TEST12',
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
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
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
				claimed_at: null as string | null,
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
			claimed_at: new Date().toISOString(),
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
				claimed_at: new Date().toISOString(),
			});
		}
	}
	return squares;
}

export const mockNumbers = {
	party_id: 'test-party-id',
	row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
	assigned_at: new Date().toISOString(),
};

export const mockScores = {
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

/** The get_party_state response for a party's fixture rows. */
export function partyStateBody(
	partyData: Record<string, unknown>,
	squaresData: unknown[],
	scoresData: unknown,
	winnersData: unknown[] = []
) {
	return {
		party: partyData,
		squares: squaresData,
		numbers: partyData.status === 'filling' ? null : mockNumbers,
		scores: scoresData,
		winners: winnersData,
		game: null,
	};
}

interface MockOverrides {
	partyOverrides?: Record<string, unknown>;
	squaresData?: ReturnType<typeof generateEmptySquares>;
	scoresOverrides?: Record<string, unknown>;
	winnersData?: typeof mockWinnersAll;
}

/** Answer get_party_state with this body (null = no such party) or an HTTP error. */
export async function mockPartyState(page: Page, body: unknown, status = 200) {
	await page.route('**/rest/v1/rpc/get_party_state', (route) => {
		route.fulfill({
			status,
			contentType: 'application/json',
			body: JSON.stringify(status === 200 ? body : { message: 'Internal Server Error' }),
		});
	});
}

export async function setupSupabaseMocksWithOverrides(page: Page, overrides: MockOverrides = {}) {
	const partyData = { ...mockParty, ...overrides.partyOverrides };
	const squaresData = overrides.squaresData ?? generateEmptySquares(partyData.id as string);
	const scoresData = { ...mockScores, ...overrides.scoresOverrides };
	const winnersData = overrides.winnersData ?? [];

	// The only REST table reads the app makes: the scores and winners refetch
	// after a broadcast (game-realtime.ts). Everything else goes through RPCs.
	await page.context().route('**/rest/v1/scores*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(scoresData),
		});
	});

	await page.context().route('**/rest/v1/winners*', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(winnersData),
		});
	});

	// The join page's preview and host-name check (migration 040).
	await page.context().route('**/rest/v1/rpc/get_party_preview', (route) => {
		const { p_code } = route.request().postDataJSON() as { p_code: string };
		const known = p_code.toUpperCase() === String(partyData.code).toUpperCase();
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(
				known
					? {
							party: partyData,
							filled_count: squaresData.filter((s) => s.player_name).length,
						}
					: null
			),
		});
	});

	// The party page loads everything through one RPC (migration 039).
	await page.context().route('**/rest/v1/rpc/get_party_state', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(partyStateBody(partyData, squaresData, scoresData, winnersData)),
		});
	});

	// Every requested cell is claimed.
	await page.context().route('**/rest/v1/rpc/claim_squares', (route) => {
		const { p_cells } = route.request().postDataJSON() as {
			p_cells: { row: number; col: number }[];
		};
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ok: true, claimed: p_cells, taken: [] }),
		});
	});

	await page.context().route('**/rest/v1/rpc/unclaim_square', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify(true),
		});
	});

	await page.context().route('**/rest/v1/rpc/host_verify_pin', (route) => {
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ok: true }),
		});
	});

	// Mock realtime connections
	await page.context().route('**/realtime/**', (route) => {
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
	eventName?: string;
	kickoffAt?: string | null;
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
