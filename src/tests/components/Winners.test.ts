import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Winners from '$lib/components/Winners.svelte';
import { party, scores, winners } from '$lib/stores/game';
import type { Party, Scores, Winner } from '$lib/types';

// Helper to create mock party
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
		status: 'active',
		team_row_name: 'Eagles',
		team_col_name: 'Chiefs',
		team_row_color: '#004C54',
		team_col_color: '#E31837',
		created_at: new Date().toISOString(),
		updated_at: new Date().toISOString(),
		expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
		game_id: null,
		home_team_is_row: null,
		...overrides,
	};
}

// Helper to create mock scores
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

// Helper to create mock winner
function createMockWinner(overrides: Partial<Winner> = {}): Winner {
	return {
		id: 'test-winner-id',
		party_id: 'test-party-id',
		quarter: 'q1',
		winning_row: 3,
		winning_col: 7,
		player_name: 'John Doe',
		amount: 250,
		created_at: new Date().toISOString(),
		...overrides,
	};
}

describe('Winners Component', () => {
	beforeEach(() => {
		// Reset stores
		party.set(null);
		scores.set(null);
		winners.set([]);
	});

	describe('No Winners', () => {
		it('renders nothing when no winners', () => {
			winners.set([]);

			const { container } = render(Winners);

			expect(container.innerHTML).toBe('<!---->');
		});
	});

	describe('Single Winner', () => {
		it('renders winner header', () => {
			winners.set([createMockWinner()]);

			render(Winners);

			expect(screen.getByText('Winners')).toBeInTheDocument();
		});

		it('displays winner name', () => {
			winners.set([createMockWinner({ player_name: 'Alice Smith' })]);

			render(Winners);

			expect(screen.getByText('Alice Smith')).toBeInTheDocument();
		});

		it('displays quarter label for Q1', () => {
			winners.set([createMockWinner({ quarter: 'q1' })]);

			render(Winners);

			expect(screen.getByText('1st Quarter')).toBeInTheDocument();
		});

		it('displays quarter label for Q2', () => {
			winners.set([createMockWinner({ quarter: 'q2' })]);

			render(Winners);

			expect(screen.getByText('2nd Quarter')).toBeInTheDocument();
		});

		it('displays quarter label for Q3', () => {
			winners.set([createMockWinner({ quarter: 'q3' })]);

			render(Winners);

			expect(screen.getByText('3rd Quarter')).toBeInTheDocument();
		});

		it('displays quarter label for Final', () => {
			winners.set([createMockWinner({ quarter: 'final' })]);

			render(Winners);

			expect(screen.getByText('Final')).toBeInTheDocument();
		});

		it('formats winning amount as USD currency', () => {
			winners.set([createMockWinner({ amount: 250 })]);

			render(Winners);

			expect(screen.getByText('$250.00')).toBeInTheDocument();
		});

		it('displays Won label', () => {
			winners.set([createMockWinner()]);

			render(Winners);

			expect(screen.getByText('Won')).toBeInTheDocument();
		});
	});

	describe('Multiple Winners', () => {
		it('renders all winners', () => {
			winners.set([
				createMockWinner({ id: '1', quarter: 'q1', player_name: 'Alice' }),
				createMockWinner({ id: '2', quarter: 'q2', player_name: 'Bob' }),
				createMockWinner({ id: '3', quarter: 'q3', player_name: 'Charlie' }),
			]);

			render(Winners);

			expect(screen.getByText('Alice')).toBeInTheDocument();
			expect(screen.getByText('Bob')).toBeInTheDocument();
			expect(screen.getByText('Charlie')).toBeInTheDocument();
		});

		it('displays all quarter labels', () => {
			winners.set([
				createMockWinner({ id: '1', quarter: 'q1' }),
				createMockWinner({ id: '2', quarter: 'q2' }),
				createMockWinner({ id: '3', quarter: 'final' }),
			]);

			render(Winners);

			expect(screen.getByText('1st Quarter')).toBeInTheDocument();
			expect(screen.getByText('2nd Quarter')).toBeInTheDocument();
			expect(screen.getByText('Final')).toBeInTheDocument();
		});

		it('displays multiple winning amounts', () => {
			winners.set([
				createMockWinner({ id: '1', amount: 100 }),
				createMockWinner({ id: '2', amount: 200 }),
				createMockWinner({ id: '3', amount: 400 }),
			]);

			render(Winners);

			expect(screen.getByText('$100.00')).toBeInTheDocument();
			expect(screen.getByText('$200.00')).toBeInTheDocument();
			expect(screen.getByText('$400.00')).toBeInTheDocument();
		});
	});

	describe('Score Display', () => {
		it('displays score for Q1 winner', () => {
			party.set(createMockParty());
			scores.set(
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
				})
			);
			winners.set([createMockWinner({ quarter: 'q1' })]);

			render(Winners);

			expect(screen.getByText('Eagles 7 - Chiefs 3')).toBeInTheDocument();
		});

		it('displays score for Q2 winner', () => {
			party.set(createMockParty());
			scores.set(
				createMockScores({
					q2_row_score: 14,
					q2_col_score: 10,
				})
			);
			winners.set([createMockWinner({ quarter: 'q2' })]);

			render(Winners);

			expect(screen.getByText('Eagles 14 - Chiefs 10')).toBeInTheDocument();
		});

		it('displays score for Q3 winner', () => {
			party.set(createMockParty());
			scores.set(
				createMockScores({
					q3_row_score: 21,
					q3_col_score: 17,
				})
			);
			winners.set([createMockWinner({ quarter: 'q3' })]);

			render(Winners);

			expect(screen.getByText('Eagles 21 - Chiefs 17')).toBeInTheDocument();
		});

		it('displays score for Final winner', () => {
			party.set(createMockParty());
			scores.set(
				createMockScores({
					final_row_score: 28,
					final_col_score: 24,
				})
			);
			winners.set([createMockWinner({ quarter: 'final' })]);

			render(Winners);

			expect(screen.getByText('Eagles 28 - Chiefs 24')).toBeInTheDocument();
		});

		it('does not display score when scores not set', () => {
			party.set(createMockParty());
			scores.set(createMockScores());
			winners.set([createMockWinner({ quarter: 'q1' })]);

			render(Winners);

			// Should not show a score line
			expect(screen.queryByText(/Eagles.*-.*Chiefs/)).not.toBeInTheDocument();
		});
	});

	describe('Amount Formatting', () => {
		it('formats small amounts correctly', () => {
			winners.set([createMockWinner({ amount: 10 })]);

			render(Winners);

			expect(screen.getByText('$10.00')).toBeInTheDocument();
		});

		it('formats large amounts with commas', () => {
			winners.set([createMockWinner({ amount: 1500 })]);

			render(Winners);

			expect(screen.getByText('$1,500.00')).toBeInTheDocument();
		});

		it('formats decimal amounts correctly', () => {
			winners.set([createMockWinner({ amount: 125.5 })]);

			render(Winners);

			expect(screen.getByText('$125.50')).toBeInTheDocument();
		});
	});

	describe('Edge Cases', () => {
		it('handles null scores store', () => {
			party.set(createMockParty());
			scores.set(null);
			winners.set([createMockWinner()]);

			render(Winners);

			// Should still render winner without score
			expect(screen.getByText('John Doe')).toBeInTheDocument();
		});

		it('handles null party store', () => {
			party.set(null);
			scores.set(createMockScores());
			winners.set([createMockWinner()]);

			render(Winners);

			// Should still render winner without score context
			expect(screen.getByText('John Doe')).toBeInTheDocument();
		});

		it('handles zero amount', () => {
			winners.set([createMockWinner({ amount: 0 })]);

			render(Winners);

			expect(screen.getByText('$0.00')).toBeInTheDocument();
		});
	});
});
