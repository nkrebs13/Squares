import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';

vi.mock('$lib/recentParties', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/recentParties')>()),
	HOME_RECENT_PARTIES: 5,
	getRecentParties: vi.fn().mockResolvedValue([]),
	removeRecentParty: vi.fn().mockResolvedValue(undefined),
	updatePartyNickname: vi.fn().mockResolvedValue(undefined),
}));

// Import the page component
import HomePage from '../../routes/+page.svelte';
import { getRecentParties } from '$lib/recentParties';
import { createMockRecentParty } from '../factories';

describe('Home Page', () => {
	beforeEach(() => {
		// setup.ts resets mocks; restore the empty default for the RecentParties child
		vi.mocked(getRecentParties).mockResolvedValue([]);
	});

	it('renders "Football Squares" heading', () => {
		render(HomePage);
		expect(screen.getByText('Football Squares')).toBeInTheDocument();
	});

	it('renders "Create Party" link pointing to /create', () => {
		render(HomePage);
		const link = screen.getByRole('link', { name: /Create Party/i });
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute('href', '/create');
	});

	it('renders demo link pointing to the configured seeded party', () => {
		render(HomePage);
		const link = screen.getByRole('link', { name: /Try Demo/i });
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute('href', '/join?code=DEMO01');
	});

	it('renders party code input', () => {
		render(HomePage);
		const input = screen.getByPlaceholderText('Enter party code');
		expect(input).toBeInTheDocument();
		expect(input).toHaveAttribute('maxlength', '12');
	});

	it('Join button disabled when code empty', () => {
		render(HomePage);
		const button = screen.getByRole('button', { name: /Join Party/i });
		expect(button).toBeDisabled();
	});

	it('Join button enabled when code has 6 chars', async () => {
		render(HomePage);
		const user = userEvent.setup();
		const input = screen.getByPlaceholderText('Enter party code');

		await user.type(input, 'ABCD12');

		const button = screen.getByRole('button', { name: /Join Party/i });
		expect(button).toBeEnabled();
	});

	it('Join button stays disabled for incomplete codes', async () => {
		render(HomePage);
		const user = userEvent.setup();
		const input = screen.getByPlaceholderText('Enter party code');

		await user.type(input, 'ABCD');

		const button = screen.getByRole('button', { name: /Join Party/i });
		expect(button).toBeDisabled();
	});

	it('Submit navigates to /join?code=<NORMALIZED>', async () => {
		const { goto } = await import('$app/navigation');
		render(HomePage);
		const user = userEvent.setup();
		const input = screen.getByPlaceholderText('Enter party code');

		await user.type(input, 'demo-01');

		const button = screen.getByRole('button', { name: /Join Party/i });
		await user.click(button);

		expect(goto).toHaveBeenCalledWith('/join?code=DEMO01');
	});

	it("lists the visitor's recent parties", async () => {
		vi.mocked(getRecentParties).mockResolvedValueOnce([createMockRecentParty({ code: 'HOME01' })]);
		render(HomePage);
		expect(await screen.findByText('HOME01')).toBeInTheDocument();
	});

	it('renders tagline', () => {
		render(HomePage);
		expect(screen.getByText('Football squares pools for any game')).toBeInTheDocument();
	});
});
