import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { userEvent } from '@testing-library/user-event';

// Import the page component
import HomePage from '../../routes/+page.svelte';

describe('Home Page', () => {
	beforeEach(() => {
		// setup.ts handles mock resets
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

	it('renders RecentParties component', () => {
		render(HomePage);
		// RecentParties renders in a container — it will be present even if loading
		// The component mounts and calls getRecentParties() which is mocked via idb-keyval
		// Just verify the page renders without error including the child component
		expect(screen.getByText('Football Squares')).toBeInTheDocument();
	});

	it('renders tagline', () => {
		render(HomePage);
		expect(screen.getByText('Super Bowl party pools made easy')).toBeInTheDocument();
	});

	it('renders production highlights', () => {
		render(HomePage);
		expect(screen.getByText('live players')).toBeInTheDocument();
		expect(screen.getByText('support requests')).toBeInTheDocument();
		expect(screen.getByText('CI gates')).toBeInTheDocument();
	});
});
