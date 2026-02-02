import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { party, scores, squares, cleanup } from '$lib/stores/game';
import type { Party, Scores, Square } from '$lib/types';
import { mockSupabaseClient, sessionStorageMock } from '../setup';

// Mock $app/stores — must be before component import (vi.mock is hoisted)
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			params: { code: 'TEST123' },
			url: new URL('http://localhost/party/TEST123/admin'),
			route: { id: '/party/[code]/admin' },
		}),
	};
});

// Import the page component AFTER mocks are set up
import AdminPage from '../../routes/party/[code]/admin/+page.svelte';

function createMockParty(overrides: Partial<Party> = {}): Party {
	return {
		id: 'test-party-id',
		code: 'TEST123',
		host_pin: '1234',
		host_name_lower: null,
		square_price: 10,
		split_q1: 25,
		split_q2: 25,
		split_q3: 25,
		split_final: 25,
		status: 'filling',
		team_row_name: 'Eagles',
		team_col_name: 'Chiefs',
		team_row_color: '#004C54',
		team_col_color: '#E31837',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		...overrides,
	};
}

function createMockScores(overrides: Partial<Scores> = {}): Scores {
	return {
		party_id: 'test-party-id',
		q1_row_score: null,
		q1_col_score: null,
		q2_row_score: null,
		q2_col_score: null,
		q3_row_score: null,
		q3_col_score: null,
		final_row_score: null,
		final_col_score: null,
		...overrides,
	};
}

function createMockSquare(row: number, col: number, overrides: Partial<Square> = {}): Square {
	return {
		id: `sq-${row}-${col}`,
		party_id: 'test-party-id',
		row_num: row,
		col_num: col,
		player_name: null,
		player_name_lower: null,
		claimed_at: null,
		...overrides,
	};
}

function createFullGrid(): Square[] {
	const grid: Square[] = [];
	for (let row = 0; row < 10; row++) {
		for (let col = 0; col < 10; col++) {
			grid.push(
				createMockSquare(row, col, {
					player_name: `Player${row}${col}`,
					player_name_lower: `player${row}${col}`,
					claimed_at: new Date().toISOString(),
				})
			);
		}
	}
	return grid;
}

/**
 * Renders the admin page in an authorized state for the given party.
 * Sets up sessionStorage PIN, party store, and scores store before render.
 */
function renderAuthorizedAdmin(partyOverrides: Partial<Party> = {}, scoresData?: Scores) {
	const mockParty = createMockParty(partyOverrides);
	party.set(mockParty);
	scores.set(scoresData ?? createMockScores());
	sessionStorageMock.setItem('squares_pin_TEST123', '1234');
	return render(AdminPage);
}

describe('Admin Page - Score Entry', () => {
	beforeEach(() => {
		cleanup();
	});

	describe('Score Entry Visibility', () => {
		it('shows score entry section when party status is active', () => {
			renderAuthorizedAdmin({ status: 'active' });

			expect(screen.getByText('Manual Score Entry')).toBeInTheDocument();
			expect(
				screen.getByRole('button', { name: /Update Score & Calculate Winner/i })
			).toBeInTheDocument();
		});

		it('does NOT show score entry when party status is filling', () => {
			renderAuthorizedAdmin({ status: 'filling' });

			expect(screen.queryByText('Manual Score Entry')).not.toBeInTheDocument();
		});

		it('does NOT show score entry when party status is complete', () => {
			renderAuthorizedAdmin({ status: 'complete' });

			expect(screen.queryByText('Manual Score Entry')).not.toBeInTheDocument();
		});

		it('shows Game Complete message when party status is complete', () => {
			renderAuthorizedAdmin({ status: 'complete' });

			expect(screen.getByText('Game Complete')).toBeInTheDocument();
		});
	});

	describe('Score Entry Form Elements', () => {
		it('has quarter selector with all four quarters', () => {
			renderAuthorizedAdmin({ status: 'active' });

			const select = screen.getByRole('combobox', { name: /quarter/i });
			expect(select).toBeInTheDocument();

			const options = select.querySelectorAll('option');
			const optionTexts = Array.from(options).map((o) => o.textContent);
			expect(optionTexts).toContain('1st Quarter');
			expect(optionTexts).toContain('2nd Quarter');
			expect(optionTexts).toContain('3rd Quarter');
			expect(optionTexts).toContain('Final');
		});

		it('shows team names as labels for score inputs', () => {
			renderAuthorizedAdmin({
				status: 'active',
				team_row_name: 'Eagles',
				team_col_name: 'Chiefs',
			});

			expect(screen.getByLabelText('Eagles')).toBeInTheDocument();
			expect(screen.getByLabelText('Chiefs')).toBeInTheDocument();
		});

		it('shows score input fields', () => {
			renderAuthorizedAdmin({ status: 'active' });

			const rowInput = screen.getByLabelText('Eagles');
			const colInput = screen.getByLabelText('Chiefs');
			expect(rowInput).toHaveAttribute('type', 'number');
			expect(colInput).toHaveAttribute('type', 'number');
		});

		it('shows game info section during active phase', () => {
			renderAuthorizedAdmin({ status: 'active' });

			expect(screen.getByText('Game Info')).toBeInTheDocument();
			expect(
				screen.getByText(/Enter scores for each quarter as they complete/)
			).toBeInTheDocument();
		});
	});

	describe('Quarter Auto-Advancement', () => {
		it('defaults to q1 when no scores are entered', () => {
			renderAuthorizedAdmin({ status: 'active' }, createMockScores());

			const select = screen.getByRole('combobox', { name: /quarter/i }) as HTMLSelectElement;
			expect(select.value).toBe('q1');
		});

		it('advances to q2 when q1 scores are set', () => {
			renderAuthorizedAdmin(
				{ status: 'active' },
				createMockScores({ q1_row_score: 7, q1_col_score: 3 })
			);

			const select = screen.getByRole('combobox', { name: /quarter/i }) as HTMLSelectElement;
			expect(select.value).toBe('q2');
		});

		it('advances to q3 when q1 and q2 scores are set', () => {
			renderAuthorizedAdmin(
				{ status: 'active' },
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
					q2_row_score: 14,
					q2_col_score: 10,
				})
			);

			const select = screen.getByRole('combobox', { name: /quarter/i }) as HTMLSelectElement;
			expect(select.value).toBe('q3');
		});

		it('advances to final when q1, q2, q3 scores are set', () => {
			renderAuthorizedAdmin(
				{ status: 'active' },
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
					q2_row_score: 14,
					q2_col_score: 10,
					q3_row_score: 21,
					q3_col_score: 17,
				})
			);

			const select = screen.getByRole('combobox', { name: /quarter/i }) as HTMLSelectElement;
			expect(select.value).toBe('final');
		});
	});

	describe('Lock Grid → Score Entry Transition (Regression)', () => {
		it('does NOT redirect after successful lock — host stays on admin page', async () => {
			const { goto } = await import('$app/navigation');

			// Set up: filling party with full grid
			party.set(createMockParty({ status: 'filling' }));
			squares.set(createFullGrid());
			scores.set(createMockScores());
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');

			render(AdminPage);

			// Mock lockParty RPC to succeed
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

			// Mock loadParty chain: parties query
			const mockPartiesChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: createMockParty({ status: 'active' }),
					error: null,
				}),
			};
			// Mock squares query
			const mockSquaresChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnValue({
					order: vi.fn().mockResolvedValue({ data: createFullGrid(), error: null }),
				}),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			// Mock numbers query
			const mockNumbersChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: {
						party_id: 'test-party-id',
						row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
						col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
					},
					error: null,
				}),
			};
			// Mock scores query
			const mockScoresChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: createMockScores(),
					error: null,
				}),
			};
			// Mock winners query
			const mockWinnersChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				update: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockReturnThis(),
				order: vi.fn().mockResolvedValue({ data: [], error: null }),
				single: vi.fn().mockResolvedValue({ data: null, error: null }),
			};

			mockSupabaseClient.from
				.mockReturnValueOnce(mockPartiesChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockSquaresChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockNumbersChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockScoresChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockWinnersChain as ReturnType<typeof mockSupabaseClient.from>);

			// Click the lock button
			const user = userEvent.setup();
			const lockButton = screen.getByRole('button', { name: /Lock Grid & Start Game/i });
			await user.click(lockButton);

			// Wait for async operations to complete
			await waitFor(() => {
				// goto should NOT have been called — this is the critical regression check
				expect(goto).not.toHaveBeenCalled();
			});

			// Score entry section should now be visible
			await waitFor(() => {
				expect(screen.getByText('Manual Score Entry')).toBeInTheDocument();
			});
		});

		it('shows success message after locking the grid', async () => {
			party.set(createMockParty({ status: 'filling' }));
			squares.set(createFullGrid());
			scores.set(createMockScores());
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');

			render(AdminPage);

			// Mock lockParty RPC success
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

			// Mock loadParty chain (same setup as above — loadParty fetches 5 tables)
			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: createMockParty({ status: 'active' }),
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockReturnValue({
						order: vi.fn().mockResolvedValue({ data: createFullGrid(), error: null }),
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: {
							party_id: 'test-party-id',
							row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
							col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
						},
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: createMockScores(),
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockResolvedValue({ data: [], error: null }),
				} as ReturnType<typeof mockSupabaseClient.from>);

			const user = userEvent.setup();
			const lockButton = screen.getByRole('button', { name: /Lock Grid & Start Game/i });
			await user.click(lockButton);

			await waitFor(() => {
				expect(
					screen.getByText(
						'Game started! Numbers have been assigned. Enter scores below as each quarter ends.'
					)
				).toBeInTheDocument();
			});
		});
	});

	describe('Score Update Flow', () => {
		it('calls updateScore RPC with correct parameters when form is submitted', async () => {
			renderAuthorizedAdmin(
				{ status: 'active', team_row_name: 'Eagles', team_col_name: 'Chiefs' },
				createMockScores()
			);

			// Mock the RPC call for updateScore
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

			// Mock loadParty chain for after-update reload
			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: createMockParty({ status: 'active' }),
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockReturnValue({
						order: vi.fn().mockResolvedValue({ data: createFullGrid(), error: null }),
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: {
							party_id: 'test-party-id',
							row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
							col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
						},
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: createMockScores({ q1_row_score: 14, q1_col_score: 7 }),
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockResolvedValue({ data: [], error: null }),
				} as ReturnType<typeof mockSupabaseClient.from>);

			const user = userEvent.setup();

			// Set row score
			const rowInput = screen.getByLabelText('Eagles');
			await user.clear(rowInput);
			await user.type(rowInput, '14');

			// Set col score
			const colInput = screen.getByLabelText('Chiefs');
			await user.clear(colInput);
			await user.type(colInput, '7');

			// Submit
			const submitButton = screen.getByRole('button', {
				name: /Update Score & Calculate Winner/i,
			});
			await user.click(submitButton);

			await waitFor(() => {
				expect(mockSupabaseClient.rpc).toHaveBeenCalledWith('update_score', {
					p_party_id: 'test-party-id',
					p_pin: '1234',
					p_quarter: 'q1',
					p_row_score: 14,
					p_col_score: 7,
				});
			});
		});

		it('shows success message after score update', async () => {
			renderAuthorizedAdmin({ status: 'active' }, createMockScores());

			// Mock updateScore RPC success
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

			// Mock loadParty chain for after-update reload
			mockSupabaseClient.from
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: createMockParty({ status: 'active' }),
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockReturnValue({
						order: vi.fn().mockResolvedValue({ data: [], error: null }),
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: {
							party_id: 'test-party-id',
							row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
							col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
						},
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					single: vi.fn().mockResolvedValue({
						data: createMockScores({ q1_row_score: 0, q1_col_score: 0 }),
						error: null,
					}),
				} as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce({
					select: vi.fn().mockReturnThis(),
					eq: vi.fn().mockReturnThis(),
					order: vi.fn().mockResolvedValue({ data: [], error: null }),
				} as ReturnType<typeof mockSupabaseClient.from>);

			const user = userEvent.setup();
			const submitButton = screen.getByRole('button', {
				name: /Update Score & Calculate Winner/i,
			});
			await user.click(submitButton);

			await waitFor(() => {
				expect(screen.getByText(/Score updated for Q1!/)).toBeInTheDocument();
			});
		});

		it('shows error message when score update fails', async () => {
			renderAuthorizedAdmin({ status: 'active' }, createMockScores());

			// Mock updateScore RPC failure
			mockSupabaseClient.rpc.mockResolvedValueOnce({
				data: null,
				error: { message: 'DB error' },
			});

			const user = userEvent.setup();
			const submitButton = screen.getByRole('button', {
				name: /Update Score & Calculate Winner/i,
			});
			await user.click(submitButton);

			await waitFor(() => {
				expect(screen.getByText('Failed to update score. Please try again.')).toBeInTheDocument();
			});
		});
	});

	describe('Filling Phase Controls', () => {
		it('shows Start Game section when party is filling', () => {
			renderAuthorizedAdmin({ status: 'filling' });

			expect(screen.getByText('Start Game')).toBeInTheDocument();
		});

		it('shows Payout Structure section when party is filling', () => {
			renderAuthorizedAdmin({ status: 'filling' });

			expect(screen.getByText('Payout Structure')).toBeInTheDocument();
		});

		it('does NOT show filling controls when party is active', () => {
			renderAuthorizedAdmin({ status: 'active' });

			expect(screen.queryByText('Start Game')).not.toBeInTheDocument();
			expect(screen.queryByText('Payout Structure')).not.toBeInTheDocument();
		});

		it('shows lock button when grid is full', () => {
			party.set(createMockParty({ status: 'filling' }));
			squares.set(createFullGrid());
			scores.set(createMockScores());
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');

			render(AdminPage);

			expect(screen.getByRole('button', { name: /Lock Grid & Start Game/i })).toBeInTheDocument();
		});

		it('shows progress bar when grid is not full', () => {
			party.set(createMockParty({ status: 'filling' }));
			squares.set([createMockSquare(0, 0, { player_name: 'Alice', player_name_lower: 'alice' })]);
			scores.set(createMockScores());
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');

			render(AdminPage);

			expect(screen.getByText(/Grid is not full yet/)).toBeInTheDocument();
		});
	});

	describe('PIN Authorization', () => {
		it('shows PIN entry form when not authorized', () => {
			party.set(createMockParty({ status: 'active' }));
			// Do NOT set sessionStorage PIN
			render(AdminPage);

			expect(screen.getByText('Enter Host PIN')).toBeInTheDocument();
			expect(screen.queryByText('Manual Score Entry')).not.toBeInTheDocument();
		});

		it('shows party controls when authorized', () => {
			renderAuthorizedAdmin({ status: 'active' });

			expect(screen.queryByText('Enter Host PIN')).not.toBeInTheDocument();
			expect(screen.getByText('Party Status')).toBeInTheDocument();
		});
	});

	describe('Danger Zone', () => {
		it('shows delete party option when party is active', () => {
			renderAuthorizedAdmin({ status: 'active' });
			expect(screen.getByText('Danger Zone')).toBeInTheDocument();
		});

		it('shows delete party option when party is filling', () => {
			renderAuthorizedAdmin({ status: 'filling' });
			expect(screen.getByText('Danger Zone')).toBeInTheDocument();
		});

		it('shows delete party option when party is complete', () => {
			renderAuthorizedAdmin({ status: 'complete' });
			expect(screen.getByText('Danger Zone')).toBeInTheDocument();
		});
	});
});
