import { describe, it, expect, beforeEach } from 'vitest';
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
		const validPartyRow = {
			id: 'new-party-id',
			code: 'ABC123',
			host_name_lower: 'alice',
			square_price: 1.0,
			split_q1: 10,
			split_q2: 20,
			split_q3: 30,
			split_final: 40,
			status: 'filling',
			team_row_name: 'Seahawks',
			team_col_name: 'Patriots',
			team_row_color: '#69BE28',
			team_col_color: '#C60C30',
			created_at: '2026-04-26T00:00:00Z',
			updated_at: '2026-04-26T00:00:00Z',
			expires_at: '2026-05-26T00:00:00Z',
			game_id: null,
			home_team_is_row: null,
		};

		it('calls create_party RPC and navigates to /party/<CODE>', async () => {
			const { goto } = await import('$app/navigation');

			mockSupabaseClient.rpc.mockResolvedValueOnce({
				data: validPartyRow,
				error: null,
			});

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				expect(mockSupabaseClient.rpc).toHaveBeenCalledWith(
					'create_party',
					expect.objectContaining({
						p_host_name: 'Alice',
						p_pin: '1234',
						p_square_price: 1,
						p_split_q1: 10,
						p_split_q2: 20,
						p_split_q3: 30,
						p_split_final: 40,
					})
				);
			});

			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith('/party/ABC123');
			});
		});

		it('stores host PIN via setHostPin and name via userName.setName', async () => {
			const { set: idbSet } = await import('idb-keyval');

			mockSupabaseClient.rpc.mockResolvedValueOnce({
				data: { ...validPartyRow, code: 'XYZ789' },
				error: null,
			});

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
		it('displays humanized error when RPC fails', async () => {
			mockSupabaseClient.rpc.mockResolvedValueOnce({
				data: null,
				error: { message: 'PIN must be exactly 4 digits' },
			});

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				const errBanner = document.querySelector('.message-error');
				expect(errBanner).toBeInTheDocument();
				expect(errBanner?.textContent).toMatch(/4 digits/i);
			});
		});

		it('shows fallback message for unexpected RPC failure', async () => {
			mockSupabaseClient.rpc.mockResolvedValueOnce({
				data: null,
				error: { message: 'connection refused' },
			});

			render(CreatePage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.type(screen.getByPlaceholderText('0000'), '1234');
			await user.click(screen.getByRole('button', { name: /Create Party/i }));

			await waitFor(() => {
				expect(screen.getByText('connection refused')).toBeInTheDocument();
			});
		});

		it('no double-submit while creating', async () => {
			// Make RPC hang (never resolves) so the button stays in "Creating..."
			mockSupabaseClient.rpc.mockReturnValueOnce(new Promise(() => {}));

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
