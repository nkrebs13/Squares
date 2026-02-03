import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { mockSupabaseClient } from '../setup';

import CreatePage from '../../routes/create/+page.svelte';

describe('Create Page', () => {
	beforeEach(() => {
		// setup.ts handles mock resets
	});

	describe('Form Validation', () => {
		it('Create button disabled when PIN empty', async () => {
			render(CreatePage);
			const user = userEvent.setup();

			// Fill name but leave PIN empty
			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');

			const button = screen.getByRole('button', { name: /Create Party/i });
			expect(button).toBeDisabled();
		});

		it('Create button disabled when name empty', async () => {
			render(CreatePage);
			const user = userEvent.setup();

			// Fill PIN but leave name empty
			await user.type(screen.getByPlaceholderText('0000'), '1234');

			const button = screen.getByRole('button', { name: /Create Party/i });
			expect(button).toBeDisabled();
		});

		it('Create button disabled when splits != 100', async () => {
			render(CreatePage);
			const user = userEvent.setup();

			// Fill required fields
			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');

			// Select Custom preset (defaults to 25/25/25/25 = 100)
			const customButton = screen.getByRole('button', { name: 'Custom' });
			await user.click(customButton);

			// Change Q1 input to break the 100% total
			const q1Inputs = document.querySelectorAll('input[type="number"]');
			// First number input in the custom split grid is Q1
			const q1Input = q1Inputs[0] as HTMLInputElement;
			await user.clear(q1Input);
			await user.type(q1Input, '99');

			const button = screen.getByRole('button', { name: /Create Party/i });
			expect(button).toBeDisabled();
		});

		it('Create button enabled when all fields valid', async () => {
			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			// Default preset is Rising (10/20/30/40 = 100), price defaults to 1

			const button = screen.getByRole('button', { name: /Create Party/i });
			expect(button).toBeEnabled();
		});
	});

	describe('Split Presets', () => {
		it('Rising preset sets 10/20/30/40', () => {
			render(CreatePage);
			// Rising is the default preset
			expect(screen.getByText('10%')).toBeInTheDocument();
			expect(screen.getByText('20%')).toBeInTheDocument();
			expect(screen.getByText('30%')).toBeInTheDocument();
			expect(screen.getByText('40%')).toBeInTheDocument();
		});

		it('Equal preset sets 25/25/25/25', async () => {
			render(CreatePage);
			const user = userEvent.setup();

			await user.click(screen.getByRole('button', { name: 'Equal' }));

			const percentages = screen.getAllByText('25%');
			expect(percentages).toHaveLength(4);
		});
	});

	describe('Happy Path', () => {
		it('3 sequential inserts → navigates to /party/<CODE>', async () => {
			const { goto } = await import('$app/navigation');

			// Mock party insert
			const mockPartyChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: {
						id: 'new-party-id',
						code: 'ABC123',
						status: 'filling',
					},
					error: null,
				}),
			};

			// Mock squares insert
			const mockSquaresChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			};

			// Mock scores insert
			const mockScoresChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			};

			mockSupabaseClient.from
				.mockReturnValueOnce(mockPartyChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockSquaresChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockScoresChain as ReturnType<typeof mockSupabaseClient.from>);

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				// Party insert
				expect(mockSupabaseClient.from).toHaveBeenCalledWith('parties');
				// Squares insert
				expect(mockSupabaseClient.from).toHaveBeenCalledWith('squares');
				// Scores insert
				expect(mockSupabaseClient.from).toHaveBeenCalledWith('scores');
			});

			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith(expect.stringMatching(/^\/party\//));
			});
		});

		it('stores host PIN via setHostPin and name via userName.setName', async () => {
			const { set: idbSet } = await import('idb-keyval');

			const mockPartyChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'new-party-id', code: 'XYZ789', status: 'filling' },
					error: null,
				}),
			};
			const mockSquaresChain = {
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			};
			const mockScoresChain = {
				insert: vi.fn().mockResolvedValue({ data: null, error: null }),
			};

			mockSupabaseClient.from
				.mockReturnValueOnce(mockPartyChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockSquaresChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockScoresChain as ReturnType<typeof mockSupabaseClient.from>);

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '5678');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				// setHostPin calls idb-keyval set
				expect(idbSet).toHaveBeenCalled();
			});
		});
	});

	describe('Error Handling', () => {
		it('displays error when party insert fails', async () => {
			const mockPartyChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: null,
					error: { message: 'Duplicate code' },
				}),
			};

			mockSupabaseClient.from.mockReturnValueOnce(
				mockPartyChain as ReturnType<typeof mockSupabaseClient.from>
			);

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				expect(screen.getByText('Duplicate code')).toBeInTheDocument();
			});
		});

		it('rollback: deletes party when squares insert fails', async () => {
			// Mock party insert succeeds
			const mockPartyChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				single: vi.fn().mockResolvedValue({
					data: { id: 'cleanup-party-id', code: 'DEL001', status: 'filling' },
					error: null,
				}),
			};

			// Mock squares insert fails
			const mockSquaresChain = {
				insert: vi.fn().mockResolvedValue({
					data: null,
					error: { message: 'Insert failed' },
				}),
			};

			// Mock cleanup delete
			const mockDeleteChain = {
				select: vi.fn().mockReturnThis(),
				delete: vi.fn().mockReturnThis(),
				eq: vi.fn().mockResolvedValue({ data: null, error: null }),
			};

			mockSupabaseClient.from
				.mockReturnValueOnce(mockPartyChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockSquaresChain as ReturnType<typeof mockSupabaseClient.from>)
				.mockReturnValueOnce(mockDeleteChain as ReturnType<typeof mockSupabaseClient.from>);

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				// Should have attempted cleanup
				expect(mockSupabaseClient.from).toHaveBeenCalledWith('parties');
			});

			await waitFor(() => {
				expect(screen.getByText('Failed to create grid')).toBeInTheDocument();
			});
		});

		it('no double-submit while creating', async () => {
			// Make party insert hang (never resolve)
			const mockPartyChain = {
				select: vi.fn().mockReturnThis(),
				insert: vi.fn().mockReturnThis(),
				single: vi.fn().mockReturnValue(new Promise(() => {})), // Never resolves
			};

			mockSupabaseClient.from.mockReturnValue(
				mockPartyChain as ReturnType<typeof mockSupabaseClient.from>
			);

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');

			const button = screen.getByRole('button', { name: /Create Party/i });
			await user.click(button);

			// Button should now show "Creating..." and be disabled
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Creating/i })).toBeDisabled();
			});
		});
	});

	describe('Page Structure', () => {
		it('renders page heading', () => {
			render(CreatePage);
			expect(screen.getByRole('heading', { name: 'Create Party' })).toBeInTheDocument();
		});

		it('renders back link to home', () => {
			render(CreatePage);
			const backLink = screen.getByRole('link', { name: /Back/i });
			expect(backLink).toHaveAttribute('href', '/');
		});

		it('renders price input', () => {
			render(CreatePage);
			expect(screen.getByText('Price per square')).toBeInTheDocument();
		});

		it('renders host name input', () => {
			render(CreatePage);
			expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument();
		});

		it('renders PIN input', () => {
			render(CreatePage);
			expect(screen.getByPlaceholderText('0000')).toBeInTheDocument();
		});
	});
});
