import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';
import { mockSupabaseClient, sessionStorageMock } from '../setup';
import { userName } from '$lib/stores/user';
import { createMockParty } from '../factories';

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

type PreviewParty = ReturnType<typeof createMockParty> | null;

function previewParty(overrides: Record<string, unknown> = {}) {
	return createMockParty({
		id: 'party-id',
		code: 'DEMO01',
		event_name: '2027 Championship',
		kickoff_at: '2027-02-14T23:30:00.000Z',
		status: 'filling',
		team_row_name: 'Ravens',
		team_col_name: 'Lions',
		square_price: 5,
		split_q1: 10,
		split_q2: 20,
		split_q3: 30,
		split_final: 40,
		host_name_lower: null,
		...overrides,
	});
}

/**
 * Answer RPCs by name. Each get_party_preview call takes the next party from
 * `previews` (the last one repeats); host_verify_pin answers `verify`.
 */
function serve({
	previews = [previewParty()],
	filled = 12,
	verify = { ok: true },
}: { previews?: PreviewParty[]; filled?: number; verify?: unknown } = {}) {
	let call = 0;
	mockSupabaseClient.rpc.mockImplementation(((name: string) => {
		if (name === 'get_party_preview') {
			const party = previews[Math.min(call++, previews.length - 1)];
			return Promise.resolve({
				data: party ? { party, filled_count: filled } : null,
				error: null,
			});
		}
		if (name === 'host_verify_pin') return Promise.resolve({ data: verify, error: null });
		return Promise.resolve({ data: null, error: null });
	}) as never);
}

describe('Join Page', () => {
	beforeEach(async () => {
		await userName.setName('');
		serve();
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
			expect(screen.getByTestId('join-payout-q1')).toHaveTextContent('$50');
			expect(screen.getByTestId('join-payout-q2')).toHaveTextContent('$100');
			expect(screen.getByTestId('join-payout-q3')).toHaveTextContent('$150');
			expect(screen.getByTestId('join-payout-final')).toHaveTextContent('$200');
			expect(screen.getByText('filling')).toBeInTheDocument();
		});

		it('ignores stale preview results after code becomes incomplete', async () => {
			let resolvePreview!: (value: unknown) => void;
			mockSupabaseClient.rpc.mockImplementationOnce(
				() => new Promise((resolve) => (resolvePreview = resolve)) as never
			);

			render(JoinPage);
			const user = userEvent.setup();
			const codeInput = await screen.findByPlaceholderText('ABCD12');

			await user.clear(codeInput);
			resolvePreview({ data: { party: previewParty(), filled_count: 12 }, error: null });

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
			serve({ previews: [previewParty(), null] });

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

			serve({ previews: [previewParty()] });

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

			serve({ previews: [previewParty({ host_name_lower: 'alice' })] });

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
			serve({ previews: [previewParty({ host_name_lower: 'alice' })] });

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

			serve({
				previews: [previewParty({ host_name_lower: 'alice' })],
				verify: { ok: false, error: 'invalid_pin' },
			});

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

			serve({ previews: [previewParty({ host_name_lower: 'alice' })] });

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

			serve({ previews: [previewParty({ host_name_lower: 'alice' })] });

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
