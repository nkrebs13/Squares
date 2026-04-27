import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Square from '$lib/components/Square.svelte';
import type { Square as SquareType, Winner } from '$lib/types';
import { userName } from '$lib/stores/user';

// Helper to create a mock square
function createMockSquare(overrides: Partial<SquareType> = {}): SquareType {
	return {
		id: 'test-square-id',
		party_id: 'test-party-id',
		row_num: 0,
		col_num: 0,
		player_name: null,
		player_name_lower: null,
		claimed_at: null,
		...overrides,
	};
}

// Helper to create a mock winner
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

describe('Square Component', () => {
	beforeEach(() => {
		// Reset userName store
		userName.setName('TestUser');
	});

	describe('Rendering', () => {
		it('renders an empty square correctly', () => {
			const square = createMockSquare();

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toBeInTheDocument();
			expect(button).toHaveClass('square-empty');
			expect(button).not.toBeDisabled();
		});

		it('renders a claimed square with player initials', () => {
			const square = createMockSquare({
				player_name: 'John Doe',
				player_name_lower: 'john doe',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveTextContent('JD');
			expect(button).toHaveClass('square-claimed');
		});

		it('renders single name initials correctly', () => {
			const square = createMockSquare({
				player_name: 'Mike',
				player_name_lower: 'mike',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			expect(screen.getByText('MI')).toBeInTheDocument();
		});

		it('renders user own square with square-mine class', async () => {
			await userName.setName('testuser');

			const square = createMockSquare({
				player_name: 'TestUser',
				player_name_lower: 'testuser',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveClass('square-mine');
		});

		it('applies custom size prop', () => {
			const square = createMockSquare();

			render(Square, {
				props: {
					square,
					isLocked: false,
					size: 60,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveStyle({ width: '60px', height: '60px' });
		});
	});

	describe('Winner Display', () => {
		it('displays quarter badge for winning square', () => {
			const square = createMockSquare({
				player_name: 'Winner Player',
				player_name_lower: 'winner player',
			});
			const winners = [createMockWinner({ quarter: 'q1' })];

			render(Square, {
				props: {
					square,
					isLocked: true,
					winners,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveClass('square-winner');
			expect(screen.getByText('1')).toBeInTheDocument();
		});

		it('displays multiple quarter badges for multi-winner', () => {
			const square = createMockSquare({
				player_name: 'Multi Winner',
				player_name_lower: 'multi winner',
			});
			const winners = [createMockWinner({ quarter: 'q1' }), createMockWinner({ quarter: 'q3' })];

			render(Square, {
				props: {
					square,
					isLocked: true,
					winners,
				},
			});

			expect(screen.getByText('1')).toBeInTheDocument();
			expect(screen.getByText('3')).toBeInTheDocument();
		});

		it('displays F badge for final quarter winner', () => {
			const square = createMockSquare({
				player_name: 'Final Winner',
				player_name_lower: 'final winner',
			});
			const winners = [createMockWinner({ quarter: 'final' })];

			render(Square, {
				props: {
					square,
					isLocked: true,
					winners,
				},
			});

			expect(screen.getByText('F')).toBeInTheDocument();
		});
	});

	describe('Disabled States', () => {
		it('disables square when locked', () => {
			const square = createMockSquare();

			render(Square, {
				props: {
					square,
					isLocked: true,
				},
			});

			expect(screen.getByRole('button')).toBeDisabled();
		});

		it('disables square claimed by another player', async () => {
			await userName.setName('currentuser');

			const square = createMockSquare({
				player_name: 'Other Player',
				player_name_lower: 'other player',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			expect(screen.getByRole('button')).toBeDisabled();
		});

		it('enables square claimed by current user for unclaiming', async () => {
			await userName.setName('myname');

			const square = createMockSquare({
				player_name: 'MyName',
				player_name_lower: 'myname',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			expect(screen.getByRole('button')).not.toBeDisabled();
		});
	});

	describe('Selection State', () => {
		it('applies selected class when isSelected is true', () => {
			const square = createMockSquare();

			render(Square, {
				props: {
					square,
					isLocked: false,
					isSelected: true,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveClass('square-selected');
			expect(button).toHaveAttribute('aria-pressed', 'true');
		});

		it('applies pending class when isPending is true', () => {
			const square = createMockSquare();

			render(Square, {
				props: {
					square,
					isLocked: false,
					isPending: true,
				},
			});

			expect(screen.getByRole('button')).toHaveClass('square-pending');
		});
	});

	describe('Accessibility', () => {
		it('has proper aria-label for empty square', () => {
			const square = createMockSquare();

			render(Square, {
				props: {
					square,
					isLocked: false,
					rowNumber: 3,
					colNumber: 7,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveAttribute(
				'aria-label',
				'Row 3, Column 7. Empty square. Press to claim or hold to multi-select.'
			);
		});

		it('has proper aria-label for claimed square', () => {
			const square = createMockSquare({
				player_name: 'John Doe',
				player_name_lower: 'john doe',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
					rowNumber: 5,
					colNumber: 2,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveAttribute('aria-label', 'Row 5, Column 2. Claimed by John Doe.');
		});

		it('has proper aria-label for own square', async () => {
			await userName.setName('myname');

			const square = createMockSquare({
				player_name: 'MyName',
				player_name_lower: 'myname',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
					rowNumber: 1,
					colNumber: 1,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveAttribute(
				'aria-label',
				'Row 1, Column 1. Your square. Press to unclaim.'
			);
		});

		it('has proper aria-label for winner square', () => {
			const square = createMockSquare({
				player_name: 'Winner',
				player_name_lower: 'winner',
			});
			const winners = [createMockWinner({ quarter: 'q1' }), createMockWinner({ quarter: 'final' })];

			render(Square, {
				props: {
					square,
					isLocked: true,
					winners,
					rowNumber: 4,
					colNumber: 6,
				},
			});

			const button = screen.getByRole('button');
			expect(button).toHaveAttribute(
				'aria-label',
				'Row 4, Column 6. Winner for Q1, Final, claimed by Winner.'
			);
		});

		it('has title attribute with player name', () => {
			const square = createMockSquare({
				player_name: 'Player Name',
				player_name_lower: 'player name',
			});

			render(Square, {
				props: {
					square,
					isLocked: false,
				},
			});

			expect(screen.getByRole('button')).toHaveAttribute('title', 'Player Name');
		});
	});

	describe('Event Handlers', () => {
		it('calls onpointerdown when pointer down', async () => {
			const square = createMockSquare();
			const onpointerdown = vi.fn();

			render(Square, {
				props: {
					square,
					isLocked: false,
					onpointerdown,
				},
			});

			await fireEvent.pointerDown(screen.getByRole('button'));
			expect(onpointerdown).toHaveBeenCalledTimes(1);
		});

		it('calls onpointerenter when pointer enters', async () => {
			const square = createMockSquare();
			const onpointerenter = vi.fn();

			render(Square, {
				props: {
					square,
					isLocked: false,
					onpointerenter,
				},
			});

			await fireEvent.pointerEnter(screen.getByRole('button'));
			expect(onpointerenter).toHaveBeenCalledTimes(1);
		});

		it('calls onpointerup when pointer up', async () => {
			const square = createMockSquare();
			const onpointerup = vi.fn();

			render(Square, {
				props: {
					square,
					isLocked: false,
					onpointerup,
				},
			});

			await fireEvent.pointerUp(screen.getByRole('button'));
			expect(onpointerup).toHaveBeenCalledTimes(1);
		});
	});
});
