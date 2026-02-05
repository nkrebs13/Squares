import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ScoreBoard from '$lib/components/ScoreBoard.svelte';
import { party, scores, gameScores } from '$lib/stores/game';
import { theme } from '$lib/stores/theme';
import type { Party, Scores, GameScoresRow } from '$lib/types';

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

// Helper to create mock game scores
function createMockGameScores(overrides: Partial<GameScoresRow> = {}): GameScoresRow {
	return {
		game_id: 'test-game-id',
		sport: 'nfl',
		home_team_abbrev: 'PHI',
		away_team_abbrev: 'KC',
		home_team_name: 'Eagles',
		away_team_name: 'Chiefs',
		home_score: 0,
		away_score: 0,
		game_clock: '',
		game_quarter: 0,
		game_status: 'pregame',
		q1_home: null,
		q1_away: null,
		q2_home: null,
		q2_away: null,
		q3_home: null,
		q3_away: null,
		q4_home: null,
		q4_away: null,
		final_home: null,
		final_away: null,
		updated_at: new Date().toISOString(),
		...overrides,
	};
}

describe('ScoreBoard Component', () => {
	beforeEach(() => {
		// Reset stores
		party.set(null);
		scores.set(null);
		gameScores.set(null);
		theme.setTeams({
			rowColor: '#004C54',
			colColor: '#E31837',
			rowName: 'Eagles',
			colName: 'Chiefs',
		});
	});

	describe('Basic Rendering', () => {
		it('renders team names from theme', () => {
			party.set(createMockParty());
			scores.set(createMockScores());

			render(ScoreBoard);

			expect(screen.getByText('Eagles')).toBeInTheDocument();
			expect(screen.getByText('Chiefs')).toBeInTheDocument();
		});

		it('displays vs separator', () => {
			party.set(createMockParty());
			scores.set(createMockScores());

			render(ScoreBoard);

			expect(screen.getByText('vs')).toBeInTheDocument();
		});

		it('shows 0-0 score when no scores entered', () => {
			party.set(createMockParty());
			scores.set(createMockScores());

			render(ScoreBoard);

			const scoreValues = screen.getAllByText('0');
			expect(scoreValues.length).toBe(2);
		});
	});

	describe('Quarter Scores Display', () => {
		it('shows quarter scores grid when party is active', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(createMockScores());

			render(ScoreBoard);

			expect(screen.getByText('Q1')).toBeInTheDocument();
			expect(screen.getByText('Q2')).toBeInTheDocument();
			expect(screen.getByText('Q3')).toBeInTheDocument();
			expect(screen.getByText('Final')).toBeInTheDocument();
		});

		it('shows quarter scores grid when party is complete', () => {
			party.set(createMockParty({ status: 'complete' }));
			scores.set(createMockScores());

			render(ScoreBoard);

			expect(screen.getByText('Q1')).toBeInTheDocument();
			expect(screen.getByText('Final')).toBeInTheDocument();
		});

		it('does not show quarter grid when party is filling', () => {
			party.set(createMockParty({ status: 'filling' }));
			scores.set(createMockScores());

			render(ScoreBoard);

			expect(screen.queryByText('Q1')).not.toBeInTheDocument();
		});

		it('REGRESSION: shows quarter grid when party is locked (not just active)', () => {
			party.set(createMockParty({ status: 'locked' }));
			scores.set(createMockScores());

			render(ScoreBoard);

			expect(screen.getByText('Q1')).toBeInTheDocument();
		});

		it('displays dash when quarter scores are null', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(createMockScores());

			render(ScoreBoard);

			// Each quarter should have "- - -" pattern (row score - col score)
			const dashes = screen.getAllByText('- - -');
			expect(dashes.length).toBe(4); // Q1, Q2, Q3, Final
		});
	});

	describe('Current Quarter Score', () => {
		it('displays Q1 scores as current when only Q1 is set', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
				})
			);

			render(ScoreBoard);

			// Main scoreboard should show Q1 scores
			expect(screen.getByText('7')).toBeInTheDocument();
			expect(screen.getByText('3')).toBeInTheDocument();
		});

		it('displays Q2 scores as current when Q2 is the latest', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
					q2_row_score: 14,
					q2_col_score: 10,
				})
			);

			render(ScoreBoard);

			// Main scoreboard should show Q2 scores (latest)
			expect(screen.getByText('14')).toBeInTheDocument();
			expect(screen.getByText('10')).toBeInTheDocument();
		});

		it('displays final scores as current when all quarters set', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
					q2_row_score: 14,
					q2_col_score: 10,
					q3_row_score: 21,
					q3_col_score: 17,
					final_row_score: 28,
					final_col_score: 24,
				})
			);

			render(ScoreBoard);

			// Main scoreboard should show final scores
			expect(screen.getByText('28')).toBeInTheDocument();
			expect(screen.getByText('24')).toBeInTheDocument();
		});
	});

	describe('Quarter Grid Scores', () => {
		it('displays individual quarter scores in grid', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(
				createMockScores({
					q1_row_score: 7,
					q1_col_score: 3,
					q2_row_score: 14,
					q2_col_score: 10,
				})
			);

			render(ScoreBoard);

			// Quarter grid should show formatted scores
			expect(screen.getByText('7 - 3')).toBeInTheDocument();
			expect(screen.getByText('14 - 10')).toBeInTheDocument();
		});
	});

	describe('Live Scores via gameScores', () => {
		it('shows live scores when game is in progress', () => {
			party.set(
				createMockParty({ status: 'active', game_id: 'test-game-id', home_team_is_row: true })
			);
			scores.set(createMockScores());
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 7,
					game_status: 'in_progress',
					game_quarter: 2,
					game_clock: '5:30',
				})
			);

			render(ScoreBoard);

			// Should show live scores (home=row=14, away=col=7)
			expect(screen.getByText('14')).toBeInTheDocument();
			expect(screen.getByText('7')).toBeInTheDocument();
			// Should show live badge with quarter label inside the live-label span
			const liveLabel = document.querySelector('.live-label');
			expect(liveLabel).toHaveTextContent('Q2');
			expect(screen.getByText('5:30')).toBeInTheDocument();
		});

		it('maps away to row when home_team_is_row is false', () => {
			party.set(
				createMockParty({ status: 'active', game_id: 'test-game-id', home_team_is_row: false })
			);
			scores.set(createMockScores());
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 7,
					game_status: 'in_progress',
					game_quarter: 1,
					game_clock: '10:00',
				})
			);

			render(ScoreBoard);

			// Row=away=7, Col=home=14
			expect(screen.getByText('7')).toBeInTheDocument();
			expect(screen.getByText('14')).toBeInTheDocument();
		});

		it('shows vs when game status is pregame', () => {
			party.set(
				createMockParty({ status: 'active', game_id: 'test-game-id', home_team_is_row: true })
			);
			scores.set(createMockScores());
			gameScores.set(
				createMockGameScores({
					game_status: 'pregame',
				})
			);

			render(ScoreBoard);

			expect(screen.getByText('vs')).toBeInTheDocument();
		});

		it('shows HALF during halftime', () => {
			party.set(
				createMockParty({ status: 'active', game_id: 'test-game-id', home_team_is_row: true })
			);
			scores.set(createMockScores());
			gameScores.set(
				createMockGameScores({
					home_score: 14,
					away_score: 10,
					game_status: 'halftime',
					game_quarter: 2,
				})
			);

			render(ScoreBoard);

			expect(screen.getByText('HALF')).toBeInTheDocument();
		});
	});

	describe('Edge Cases', () => {
		it('handles null scores store', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(null);

			render(ScoreBoard);

			// Should still render without crashing
			expect(screen.getByText('vs')).toBeInTheDocument();
		});

		it('handles null party store', () => {
			party.set(null);
			scores.set(createMockScores());

			render(ScoreBoard);

			// Should still render basic layout
			expect(screen.getByText('vs')).toBeInTheDocument();
		});

		it('handles zero scores correctly', () => {
			party.set(createMockParty({ status: 'active' }));
			scores.set(
				createMockScores({
					q1_row_score: 0,
					q1_col_score: 0,
				})
			);

			render(ScoreBoard);

			// Should display 0 - 0, not dashes
			expect(screen.getByText('0 - 0')).toBeInTheDocument();
		});
	});
});
