import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { get } from 'svelte/store';
import { tick } from 'svelte';
import {
	party,
	squares,
	numbers,
	scores,
	winners,
	isLoading,
	error,
	cleanup,
	openParty,
} from '$lib/stores/game';
import { userName } from '$lib/stores/user';
import type { Square } from '$lib/types';
import { sessionStorageMock } from '../setup';
import { DESKTOP_LAYOUT_QUERY } from '$lib/layout';

// Mock $app/stores
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return {
		page: readable({
			params: { code: 'TEST123' },
			url: new URL('http://localhost/party/TEST123'),
			route: { id: '/party/[code]' },
		}),
	};
});

// Tests set the party stores directly; opening the party must not reload over them.
vi.mock('$lib/stores/game', async (importOriginal) => {
	const original = (await importOriginal()) as Record<string, unknown>;
	return { ...original, openParty: vi.fn().mockResolvedValue(true) };
});

vi.mock('$lib/recentParties', () => ({
	saveRecentParty: vi.fn().mockResolvedValue(undefined),
	getRecentParties: vi.fn().mockResolvedValue([]),
	stageNickname: vi.fn(),
}));

import { saveRecentParty } from '$lib/recentParties';
import PartyPage from '../../routes/party/[code]/+page.svelte';
import { get as idbGet } from 'idb-keyval';

/** Whether the browser has already recorded the gesture hint as seen. */
function hintAlreadySeen(seen: boolean) {
	vi.mocked(idbGet).mockImplementation(
		(key) => Promise.resolve(key === 'squares_gesture_hint_shown' ? seen : undefined) as never
	);
}
import { createEmptyGrid, createMockParty } from '../factories';

function createFullGrid(): Square[] {
	return createEmptyGrid().map((s) => ({
		...s,
		player_name: `Player${s.row_num}${s.col_num}`,
		player_name_lower: `player${s.row_num}${s.col_num}`,
		claimed_at: new Date().toISOString(),
	}));
}

describe('Party Page', () => {
	beforeEach(async () => {
		cleanup();
		await userName.setName('TestUser');
	});

	describe('Party session', () => {
		it('opens the party named in the URL and leaves it on unmount', async () => {
			party.set(createMockParty());
			const { unmount } = render(PartyPage);
			await waitFor(() => expect(openParty).toHaveBeenCalledWith('TEST123'));
			unmount();
			expect(get(party)).toBeNull();
		});

		it('saves the recent entry once, then again when the status changes', async () => {
			const save = vi.mocked(saveRecentParty);
			save.mockClear();
			vi.mocked(openParty).mockResolvedValue(true);
			party.set(createMockParty({ code: 'TEST123', status: 'filling' }));
			render(PartyPage);
			await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
			expect(save.mock.calls[0][0].status).toBe('filling');

			party.update((p) => (p ? { ...p, status: 'active' } : p));
			await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
			expect(save.mock.calls[1][0].status).toBe('active');

			// A change that leaves the status alone does not re-save.
			party.update((p) => (p ? { ...p, event_name: 'Renamed' } : p));
			await new Promise((r) => setTimeout(r, 20));
			expect(save).toHaveBeenCalledTimes(2);
		});
	});

	describe('Loading State', () => {
		it('shows loading skeleton when isLoading is true', () => {
			isLoading.set(true);
			party.set(null);
			const { container } = render(PartyPage);

			expect(container.querySelector('.grid-skeleton')).toBeInTheDocument();
		});
	});

	describe('Error State', () => {
		it('shows error + "Go Home" when error store set', () => {
			isLoading.set(false);
			error.set('Party not found');
			render(PartyPage);

			expect(screen.getByText('Party not found')).toBeInTheDocument();
			const homeLink = screen.getByRole('link', { name: /Go Home/i });
			expect(homeLink).toHaveAttribute('href', '/');
		});
	});

	describe('No Username Redirect', () => {
		it('redirects to /join?code=X when no userName', async () => {
			const { goto } = await import('$app/navigation');
			await userName.setName('');

			isLoading.set(false);
			render(PartyPage);

			await waitFor(() => {
				expect(goto).toHaveBeenCalledWith('/join?code=TEST123');
			});
		});
	});

	describe("The host's name", () => {
		it("sends a browser using the host's name without the party's PIN to the join form", async () => {
			const { goto } = await import('$app/navigation');
			vi.mocked(goto).mockClear();
			const save = vi.mocked(saveRecentParty);
			save.mockClear();
			vi.mocked(openParty).mockResolvedValue(true);
			await userName.setName('Mike');
			party.set(createMockParty({ code: 'TEST123', host_name_lower: 'mike' }));
			render(PartyPage);
			await waitFor(() => expect(goto).toHaveBeenCalledWith('/join?code=TEST123'));
			expect(save).not.toHaveBeenCalled();
		});

		it("keeps the host on the page while this browser holds the party's PIN", async () => {
			const { goto } = await import('$app/navigation');
			vi.mocked(goto).mockClear();
			const save = vi.mocked(saveRecentParty);
			save.mockClear();
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');
			vi.mocked(openParty).mockResolvedValue(true);
			await userName.setName('Mike');
			party.set(createMockParty({ code: 'TEST123', host_name_lower: 'mike' }));
			render(PartyPage);
			await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
			expect(goto).not.toHaveBeenCalled();
		});
	});

	describe('Filling Status', () => {
		it('shows filled count banner during filling', () => {
			isLoading.set(false);
			error.set(null);
			const grid = createEmptyGrid();
			// Claim 50 squares
			for (let i = 0; i < 50; i++) {
				grid[i].player_name = 'Someone';
				grid[i].player_name_lower = 'someone';
				grid[i].claimed_at = new Date().toISOString();
			}
			party.set(createMockParty({ status: 'filling' }));
			squares.set(grid);
			scores.set(null);
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.getAllByText(/squares filled/).length).toBeGreaterThan(0);
		});

		it('shows "Ready to lock!" when grid full', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'filling' }));
			squares.set(createFullGrid());
			scores.set(null);
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.getAllByText(/Ready to lock!/).length).toBeGreaterThan(0);
		});
	});

	describe('Active Status', () => {
		it('shows ScoreBoard when status is active', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'active' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: 7,
				q1_col_score: 3,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set({
				party_id: 'test-party-id',
				row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			});
			render(PartyPage);

			// ScoreBoard component renders a scoreboard div
			expect(document.querySelector('.scoreboard')).toBeInTheDocument();
		});

		it('REGRESSION: shows ScoreBoard when status is locked', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'locked' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: null,
				q1_col_score: null,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set({
				party_id: 'test-party-id',
				row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			});
			render(PartyPage);

			expect(document.querySelector('.scoreboard')).toBeInTheDocument();
		});
	});

	describe('Complete Status', () => {
		it('shows ScoreBoard when status is complete', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'complete' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: 7,
				q1_col_score: 3,
				q2_row_score: 14,
				q2_col_score: 10,
				q3_row_score: 21,
				q3_col_score: 17,
				final_row_score: 28,
				final_col_score: 24,
			});
			winners.set([]);
			numbers.set({
				party_id: 'test-party-id',
				row_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
				col_numbers: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
			});
			render(PartyPage);

			// ScoreBoard should be visible in complete status
			expect(document.querySelector('.scoreboard')).toBeInTheDocument();
		});
	});

	describe('Host Controls', () => {
		it('shows "Host Panel" link when isHost', async () => {
			// This browser remembers the host PIN for the party.
			sessionStorageMock.setItem('squares_pin_TEST123', '1234');

			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'active' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: null,
				q1_col_score: null,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			await waitFor(() => {
				const hostLink = screen.getByRole('link', { name: /Host Panel/i });
				expect(hostLink).toBeInTheDocument();
				expect(hostLink).toHaveAttribute('href', '/party/TEST123/admin');
			});
		});

		it('hides "Host Panel" link when not isHost', async () => {
			const save = vi.mocked(saveRecentParty);
			save.mockClear();
			vi.mocked(openParty).mockResolvedValue(true);
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ status: 'active' }));
			squares.set(createFullGrid());
			scores.set({
				party_id: 'test-party-id',
				q1_row_score: null,
				q1_col_score: null,
				q2_row_score: null,
				q2_col_score: null,
				q3_row_score: null,
				q3_col_score: null,
				final_row_score: null,
				final_col_score: null,
			});
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			// The recent entry is saved after the host check has answered.
			await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
			expect(save.mock.calls[0][0].isHost).toBe(false);
			expect(screen.queryByRole('link', { name: /Host Panel/i })).not.toBeInTheDocument();
		});
	});

	describe('Team Header', () => {
		it('shows team names in header', () => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty({ team_row_name: 'Eagles', team_col_name: 'Chiefs' }));
			squares.set(createEmptyGrid());
			scores.set(null);
			winners.set([]);
			numbers.set(null);
			render(PartyPage);

			expect(screen.getAllByText('Eagles vs Chiefs').length).toBeGreaterThan(0);
		});
	});

	describe('Layout and gesture help', () => {
		beforeEach(() => {
			isLoading.set(false);
			error.set(null);
			party.set(createMockParty());
			squares.set(createEmptyGrid());
			scores.set(null);
			winners.set([]);
			numbers.set(null);
		});

		it('shows a "?" help button with an accessible name', () => {
			render(PartyPage);

			expect(screen.getByRole('button', { name: /show gesture help/i })).toBeInTheDocument();
		});

		it('offers no gesture help once the grid has stopped filling', () => {
			party.set(createMockParty({ status: 'active' }));
			render(PartyPage);

			expect(screen.queryByRole('button', { name: /show gesture help/i })).not.toBeInTheDocument();
		});

		it('mounts the sidebar once, above the grid, in the mobile layout', () => {
			const { container } = render(PartyPage);
			expect(screen.getAllByTestId('party-payout-q1')).toHaveLength(1);
			expect(container.querySelector('aside')).toBeNull();
		});

		it('mounts the sidebar once, in a side column, in the desktop layout', () => {
			window.matchMedia = vi.fn().mockImplementation((query: string) => ({
				matches: query === DESKTOP_LAYOUT_QUERY,
				media: query,
				addEventListener: () => {},
				removeEventListener: () => {},
			}));
			try {
				render(PartyPage);
				const payouts = screen.getAllByTestId('party-payout-q1');
				expect(payouts).toHaveLength(1);
				expect(payouts[0].closest('aside')).not.toBeNull();
			} finally {
				// @ts-expect-error - drop the override; setup.ts reinstalls its default
				delete window.matchMedia;
			}
		});

		it('opens the gesture hint from the help button in the desktop layout', async () => {
			hintAlreadySeen(true);
			window.matchMedia = vi.fn().mockImplementation((query: string) => ({
				matches: query === DESKTOP_LAYOUT_QUERY,
				media: query,
				addEventListener: () => {},
				removeEventListener: () => {},
			}));
			try {
				render(PartyPage);
				await userEvent.setup().click(screen.getByRole('button', { name: /show gesture help/i }));
				expect(await screen.findByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			} finally {
				// @ts-expect-error - drop the override; setup.ts reinstalls its default
				delete window.matchMedia;
			}
		});

		it('re-shows the gesture hint when clicked, after it was dismissed', async () => {
			hintAlreadySeen(false);
			render(PartyPage);

			// Hint auto-shows on mount since it hasn't been seen before
			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});

			const user = userEvent.setup();
			await user.click(screen.getByRole('button', { name: /Tap to dismiss/ }));
			await waitFor(() => {
				expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();
			});

			await user.click(screen.getByRole('button', { name: /show gesture help/i }));

			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});
		});

		it('is keyboard-focusable and activatable via Enter', async () => {
			hintAlreadySeen(true);
			render(PartyPage);

			// Not shown once the seen-flag read has answered
			await waitFor(() => expect(idbGet).toHaveBeenCalledWith('squares_gesture_hint_shown'));
			await tick();
			expect(screen.queryByRole('button', { name: /Tap to dismiss/ })).not.toBeInTheDocument();

			const helpButton = screen.getByRole('button', { name: /show gesture help/i });
			helpButton.focus();
			expect(helpButton).toHaveFocus();

			const user = userEvent.setup();
			await user.keyboard('{Enter}');

			await waitFor(() => {
				expect(screen.getByRole('button', { name: /Tap to dismiss/ })).toBeInTheDocument();
			});
		});
	});
});
