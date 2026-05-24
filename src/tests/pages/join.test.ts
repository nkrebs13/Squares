import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { mockSupabaseClient, sessionStorageMock } from '../setup';
import { userName } from '$lib/stores/user';

// Mock $app/stores with a URL that has ?code=demo-01
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			params: {},
			url: new URL('http://localhost/join?code=demo-01'),
			route: { id: '/join' },
		}),
	};
});

import JoinPage from '../../routes/join/+page.svelte';

function partyQuery(
	data: Record<string, unknown> | null,
	error: { message: string } | null = null
) {
	return {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		single: vi.fn().mockResolvedValue({ data, error }),
	};
}

function squaresQuery(data: Array<Record<string, unknown>> = []) {
	return {
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockResolvedValue({ data, error: null }),
	};
}

function claimedSquares(count: number) {
	return Array.from({ length: count }, (_, index) => ({
		player_name: `Player ${index + 1}`,
		claimed_at: '2027-02-14T20:00:00.000Z',
	}));
}

function deferredPartyQuery() {
	let resolveSingle!: (value: {
		data: Record<string, unknown> | null;
		error: { message: string } | null;
	}) => void;
	const singlePromise = new Promise<{
		data: Record<string, unknown> | null;
		error: { message: string } | null;
	}>((resolve) => {
		resolveSingle = resolve;
	});

	return {
		query: {
			select: vi.fn().mockReturnThis(),
			eq: vi.fn().mockReturnThis(),
			single: vi.fn().mockReturnValue(singlePromise),
		},
		resolveSingle,
	};
}

function previewParty(overrides: Record<string, unknown> = {}) {
	return {
		id: 'party-id',
		event_name: '2027 Championship',
		kickoff_at: '2027-02-14T23:30:00.000Z',
		status: 'filling',
		team_row_name: 'Ravens',
		team_col_name: 'Lions',
		square_price: 5,
		...overrides,
	};
}

function joinLookupParty(overrides: Record<string, unknown> = {}) {
	return {
		id: 'party-id',
		status: 'filling',
		host_name_lower: null,
		...overrides,
	};
}

describe('Join Page', () => {
	beforeEach(async () => {
		await userName.setName('');
		mockSupabaseClient.from.mockImplementation((...args: unknown[]) =>
			args[0] === 'squares'
				? (squaresQuery(claimedSquares(12)) as ReturnType<typeof mockSupabaseClient.from>)
				: (partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>)
		);
	});

	describe('Pre-fill Behavior', () => {
		it('pre-fills code from URL query param', async () => {
			render(JoinPage);

			await waitFor(() => {
				const codeInput = screen.getByPlaceholderText('ABCD12') as HTMLInputElement;
				expect(codeInput.value).toBe('DEMO01');
			});
		});

		it('pre-fills name from userName store', async () => {
			await userName.setName('StoredAlice');
			render(JoinPage);

			await waitFor(() => {
				const nameInput = screen.getByPlaceholderText('Enter your name') as HTMLInputElement;
				expect(nameInput.value).toBe('StoredAlice');
			});
		});

		it('previews party details for shared links', async () => {
			render(JoinPage);

			await expect(screen.findByText('2027 Championship')).resolves.toBeInTheDocument();
			expect(screen.getByText('Ravens vs Lions')).toBeInTheDocument();
			expect(screen.getByText('$5')).toBeInTheDocument();
			expect(screen.getByText('88')).toBeInTheDocument();
			expect(screen.getByText('Full pot: $500')).toBeInTheDocument();
			expect(screen.getByText('filling')).toBeInTheDocument();
		});

		it('ignores stale preview results after code becomes incomplete', async () => {
			const pendingPreview = deferredPartyQuery();
			mockSupabaseClient.from.mockReturnValueOnce(
				pendingPreview.query as ReturnType<typeof mockSupabaseClient.from>
			);

			render(JoinPage);
			const user = userEvent.setup();
			const codeInput = await screen.findByPlaceholderText('ABCD12');

			await user.clear(codeInput);
			pendingPreview.resolveSingle({ data: previewParty(), error: null });

			await waitFor(() => {
				expect(screen.queryByText('2027 Championship')).not.toBeInTheDocument();
			});
		});
	});

	describe('Validation', () => {
		it('Join disabled when code or name empty', () => {
			render(JoinPage);
			const button = screen.getByRole('button', { name: /Join Party/i });
			// Code is pre-filled from URL but name is empty
			expect(button).toBeDisabled();
		});

		it('Join enabled when both code and name entered', async () => {
			render(JoinPage);
			const user = userEvent.setup();

			const nameInput = screen.getByPlaceholderText('Enter your name');
			await user.type(nameInput, 'Bob');

			await waitFor(() => {
				const button = screen.getByRole('button', { name: /Join Party/i });
				expect(button).toBeEnabled();
			});
		});
	});

	describe('Party Lookup', () => {
		it('shows "not found" on miss', async () => {
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(null, { message: 'Not found' }) as ReturnType<typeof mockSupabaseClient.from>
			);

			render(JoinPage);
			const user = userEvent.setup();

			const nameInput = screen.getByPlaceholderText('Enter your name');
			await user.type(nameInput, 'Bob');

			const button = screen.getByRole('button', { name: /Join Party/i });
			await user.click(button);

			await waitFor(() => {
				expect(screen.getByText(/Party not found/i)).toBeInTheDocument();
			});
		});

		it('navigates to /party/<CODE> on success', async () => {
			const { goto } = await import('$app/navigation');

			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(joinLookupParty()) as ReturnType<typeof mockSupabaseClient.from>
			);

			render(JoinPage);
			const user = userEvent.setup();

			const nameInput = screen.getByPlaceholderText('Enter your name');
			await user.type(nameInput, 'Bob');
			await user.click(screen.getByRole('button', { name: /Join Party/i }));

			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith('/party/DEMO01');
			});
		});
	});

	describe('PIN Challenge Modal', () => {
		it('shows PIN challenge when name matches host_name_lower', async () => {
			// Mock idb-keyval getHostPin → null (no stored PIN)
			const { get: idbGet } = await import('idb-keyval');
			vi.mocked(idbGet).mockResolvedValue(null);

			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(joinLookupParty({ host_name_lower: 'alice' })) as ReturnType<
					typeof mockSupabaseClient.from
				>
			);

			render(JoinPage);
			const user = userEvent.setup();

			const nameInput = screen.getByPlaceholderText('Enter your name');
			await user.type(nameInput, 'Alice');
			await user.click(screen.getByRole('button', { name: /Join Party/i }));

			await waitFor(() => {
				expect(screen.getByText('Host Name Protected')).toBeInTheDocument();
			});
		});

		it('correct PIN → navigate + stores PIN', async () => {
			const { goto } = await import('$app/navigation');
			const { get: idbGet } = await import('idb-keyval');
			vi.mocked(idbGet).mockResolvedValue(null);

			// First call: party lookup (name matches host)
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(joinLookupParty({ host_name_lower: 'alice' })) as ReturnType<
					typeof mockSupabaseClient.from
				>
			);

			// Second call: verify_host_pin RPC
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

			render(JoinPage);
			const user = userEvent.setup();

			const nameInput = screen.getByPlaceholderText('Enter your name');
			await user.type(nameInput, 'Alice');
			await user.click(screen.getByRole('button', { name: /Join Party/i }));

			// Wait for PIN modal
			await waitFor(() => {
				expect(screen.getByText('Host Name Protected')).toBeInTheDocument();
			});

			// Enter PIN
			const pinInput = screen.getByPlaceholderText('0000');
			await user.type(pinInput, '1234');
			await user.click(screen.getByRole('button', { name: /Verify/i }));

			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith('/party/DEMO01');
			});

			// PIN should have been stored in sessionStorage
			expect(sessionStorageMock.setItem).toHaveBeenCalledWith('squares_pin_DEMO01', '1234');
		});

		it('wrong PIN → error message', async () => {
			const { get: idbGet } = await import('idb-keyval');
			vi.mocked(idbGet).mockResolvedValue(null);

			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(joinLookupParty({ host_name_lower: 'alice' })) as ReturnType<
					typeof mockSupabaseClient.from
				>
			);

			// Wrong PIN
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: false, error: null });

			render(JoinPage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.click(screen.getByRole('button', { name: /Join Party/i }));

			await waitFor(() => {
				expect(screen.getByText('Host Name Protected')).toBeInTheDocument();
			});

			await user.type(screen.getByPlaceholderText('0000'), '9999');
			await user.click(screen.getByRole('button', { name: /Verify/i }));

			await waitFor(() => {
				expect(screen.getByText(/Incorrect PIN/i)).toBeInTheDocument();
			});
		});

		it('"Use Different Name" closes modal and clears name', async () => {
			const { get: idbGet } = await import('idb-keyval');
			vi.mocked(idbGet).mockResolvedValue(null);

			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(joinLookupParty({ host_name_lower: 'alice' })) as ReturnType<
					typeof mockSupabaseClient.from
				>
			);

			render(JoinPage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.click(screen.getByRole('button', { name: /Join Party/i }));

			await waitFor(() => {
				expect(screen.getByText('Host Name Protected')).toBeInTheDocument();
			});

			await user.click(screen.getByRole('button', { name: /Use Different Name/i }));

			await waitFor(() => {
				expect(screen.queryByText('Host Name Protected')).not.toBeInTheDocument();
			});
		});

		it('auto-passes PIN if stored PIN is valid', async () => {
			const { goto } = await import('$app/navigation');
			const { get: idbGet } = await import('idb-keyval');

			// Return a stored PIN
			vi.mocked(idbGet).mockResolvedValue({ DEMO01: '1234' });

			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(previewParty()) as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				squaresQuery() as ReturnType<typeof mockSupabaseClient.from>
			);
			mockSupabaseClient.from.mockReturnValueOnce(
				partyQuery(joinLookupParty({ host_name_lower: 'alice' })) as ReturnType<
					typeof mockSupabaseClient.from
				>
			);

			// verify_host_pin RPC returns true
			mockSupabaseClient.rpc.mockResolvedValueOnce({ data: true, error: null });

			render(JoinPage);
			const user = userEvent.setup();

			await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice');
			await user.click(screen.getByRole('button', { name: /Join Party/i }));

			// Should auto-navigate without showing PIN modal
			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith('/party/DEMO01');
			});

			// Should NOT have shown the PIN challenge
			expect(screen.queryByText('Host Name Protected')).not.toBeInTheDocument();
		});
	});

	describe('Page Structure', () => {
		it('renders page heading', () => {
			render(JoinPage);
			expect(screen.getByRole('heading', { name: 'Join Party' })).toBeInTheDocument();
		});

		it('renders back link', () => {
			render(JoinPage);
			const link = screen.getByRole('link', { name: /Back/i });
			expect(link).toHaveAttribute('href', '/');
		});
	});
});
