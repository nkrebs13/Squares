import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';

// Must mock before importing the component
vi.mock('$lib/storage', () => ({
	getRecentParties: vi.fn().mockResolvedValue([]),
	removeRecentParty: vi.fn().mockResolvedValue(undefined),
	updatePartyNickname: vi.fn().mockResolvedValue(undefined),
	saveRecentParty: vi.fn().mockResolvedValue(undefined),
	getUserName: vi.fn().mockResolvedValue(null),
	setUserName: vi.fn().mockResolvedValue(undefined),
	clearUserName: vi.fn().mockResolvedValue(undefined),
}));

import RecentParties from '$lib/components/RecentParties.svelte';
import { goto } from '$app/navigation';
import { getRecentParties, removeRecentParty, updatePartyNickname } from '$lib/storage';
import type { RecentParty } from '$lib/types';

const mockGetRecentParties = vi.mocked(getRecentParties);
const mockRemoveRecentParty = vi.mocked(removeRecentParty);
const mockUpdatePartyNickname = vi.mocked(updatePartyNickname);
const mockGoto = vi.mocked(goto);

function createMockParty(overrides: Partial<RecentParty> = {}): RecentParty {
	return {
		code: 'ABC123',
		teamRowName: 'Seahawks',
		teamColName: 'Patriots',
		lastVisited: Date.now(),
		status: 'filling',
		isHost: false,
		...overrides,
	};
}

describe('RecentParties Component', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('Loading and Empty States', () => {
		it('renders nothing while loading', () => {
			// Don't resolve the promise yet
			mockGetRecentParties.mockReturnValue(new Promise(() => {}));
			render(RecentParties);

			expect(screen.queryByText('Recent Parties')).not.toBeInTheDocument();
		});

		it('renders nothing when no recent parties', async () => {
			mockGetRecentParties.mockResolvedValue([]);
			render(RecentParties);

			// Wait for mount to complete
			await vi.waitFor(() => {
				expect(screen.queryByText('Recent Parties')).not.toBeInTheDocument();
			});
		});

		it('renders party list when parties exist', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty()]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Recent Parties')).toBeInTheDocument();
			});
		});
	});

	describe('Party Display', () => {
		it('shows team matchup when no nickname', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty()]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Seahawks vs Patriots')).toBeInTheDocument();
			});
		});

		it('shows nickname when set', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ nickname: 'Super Bowl Party' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Super Bowl Party')).toBeInTheDocument();
			});
		});

		it('shows party code', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'XYZ789' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('XYZ789')).toBeInTheDocument();
			});
		});

		it('shows host badge for host parties', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ isHost: true })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Host')).toBeInTheDocument();
			});
		});

		it('does not show host badge for non-host parties', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ isHost: false })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('ABC123')).toBeInTheDocument();
				expect(screen.queryByText('Host')).not.toBeInTheDocument();
			});
		});
	});

	describe('Status Badges', () => {
		it('shows Filling badge for filling status', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ status: 'filling' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Filling')).toBeInTheDocument();
			});
		});

		it('shows Locked badge for locked status', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ status: 'locked' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Locked')).toBeInTheDocument();
			});
		});

		it('shows Live badge for active status', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ status: 'active' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Live')).toBeInTheDocument();
			});
		});

		it('shows Done badge for complete status', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ status: 'complete' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Done')).toBeInTheDocument();
			});
		});
	});

	describe('Navigation', () => {
		it('navigates to party page on click', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'NAV001' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('NAV001')).toBeInTheDocument();
			});

			const card = screen.getByText('NAV001').closest('[role="button"]');
			await fireEvent.click(card!);

			expect(mockGoto).toHaveBeenCalledWith('/party/NAV001');
		});

		it('navigates on Enter key', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'KEY001' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('KEY001')).toBeInTheDocument();
			});

			const card = screen.getByText('KEY001').closest('[role="button"]');
			await fireEvent.keyDown(card!, { key: 'Enter' });

			expect(mockGoto).toHaveBeenCalledWith('/party/KEY001');
		});
	});

	describe('Remove Party', () => {
		it('shows confirmation when remove button is clicked', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'DEL001' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('DEL001')).toBeInTheDocument();
			});

			const removeBtn = screen.getByLabelText('Remove from recent');
			await fireEvent.click(removeBtn);

			// Should show confirmation UI instead of immediately removing
			expect(screen.getByText('Remove?')).toBeInTheDocument();
			expect(screen.getByLabelText('Confirm remove')).toBeInTheDocument();
			expect(screen.getByLabelText('Cancel remove')).toBeInTheDocument();
			// Party should still be visible
			expect(screen.getByText('DEL001')).toBeInTheDocument();
			// Should not have called removeRecentParty yet
			expect(mockRemoveRecentParty).not.toHaveBeenCalled();
		});

		it('removes party when confirmation is accepted', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'DEL001' })]);
			mockRemoveRecentParty.mockResolvedValue(undefined);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('DEL001')).toBeInTheDocument();
			});

			// Click remove button to trigger confirmation
			const removeBtn = screen.getByLabelText('Remove from recent');
			await fireEvent.click(removeBtn);

			// Confirm the removal
			const confirmBtn = screen.getByLabelText('Confirm remove');
			await fireEvent.click(confirmBtn);

			expect(mockRemoveRecentParty).toHaveBeenCalledWith('DEL001');
			// Party should be removed from the list
			expect(screen.queryByText('DEL001')).not.toBeInTheDocument();
		});

		it('cancels removal when cancel button is clicked', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'DEL001' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('DEL001')).toBeInTheDocument();
			});

			// Click remove button to trigger confirmation
			const removeBtn = screen.getByLabelText('Remove from recent');
			await fireEvent.click(removeBtn);

			// Cancel the removal
			const cancelBtn = screen.getByLabelText('Cancel remove');
			await fireEvent.click(cancelBtn);

			// Party should still be visible and confirmation UI gone
			expect(screen.getByText('DEL001')).toBeInTheDocument();
			expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
			expect(mockRemoveRecentParty).not.toHaveBeenCalled();
		});

		it('does not navigate when remove button is clicked', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'RMV001' })]);
			mockRemoveRecentParty.mockResolvedValue(undefined);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('RMV001')).toBeInTheDocument();
			});

			const removeBtn = screen.getByLabelText('Remove from recent');
			await fireEvent.click(removeBtn);

			expect(mockGoto).not.toHaveBeenCalled();
		});

		it('does not navigate when confirm remove is clicked', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'RMV001' })]);
			mockRemoveRecentParty.mockResolvedValue(undefined);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('RMV001')).toBeInTheDocument();
			});

			const removeBtn = screen.getByLabelText('Remove from recent');
			await fireEvent.click(removeBtn);

			const confirmBtn = screen.getByLabelText('Confirm remove');
			await fireEvent.click(confirmBtn);

			expect(mockGoto).not.toHaveBeenCalled();
		});
	});

	describe('Inline Editing', () => {
		it('enters edit mode when nickname button is clicked', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ nickname: 'My Party' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('My Party')).toBeInTheDocument();
			});

			const editBtn = screen.getByLabelText('Edit nickname: My Party');
			await fireEvent.click(editBtn);

			expect(screen.getByLabelText('Party nickname')).toBeInTheDocument();
		});

		it('shows add nickname button when no nickname', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty()]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByLabelText('Add nickname')).toBeInTheDocument();
			});
		});

		it('saves edit on Enter key', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'EDIT01' })]);
			mockUpdatePartyNickname.mockResolvedValue(undefined);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByLabelText('Add nickname')).toBeInTheDocument();
			});

			// Enter edit mode
			await fireEvent.click(screen.getByLabelText('Add nickname'));
			const input = screen.getByLabelText('Party nickname');
			await fireEvent.input(input, { target: { value: 'New Name' } });
			await fireEvent.keyDown(input, { key: 'Enter' });

			expect(mockUpdatePartyNickname).toHaveBeenCalledWith('EDIT01', 'New Name');
		});

		it('cancels edit on Escape key', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ nickname: 'Original' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('Original')).toBeInTheDocument();
			});

			// Enter edit mode
			await fireEvent.click(screen.getByLabelText('Edit nickname: Original'));
			const input = screen.getByLabelText('Party nickname');
			await fireEvent.input(input, { target: { value: 'Changed' } });
			await fireEvent.keyDown(input, { key: 'Escape' });

			// Should show original name again, not changed
			expect(screen.getByText('Original')).toBeInTheDocument();
			expect(mockUpdatePartyNickname).not.toHaveBeenCalled();
		});

		it('does not navigate while editing', async () => {
			mockGetRecentParties.mockResolvedValue([createMockParty({ code: 'NOEDIT' })]);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByLabelText('Add nickname')).toBeInTheDocument();
			});

			// Enter edit mode
			await fireEvent.click(screen.getByLabelText('Add nickname'));

			// Click the card area
			const card = screen.getByLabelText('Party nickname').closest('[role="button"]');
			await fireEvent.click(card!);

			expect(mockGoto).not.toHaveBeenCalled();
		});
	});

	describe('Multiple Parties', () => {
		it('shows up to 5 parties', async () => {
			const parties = Array.from({ length: 7 }, (_, i) =>
				createMockParty({
					code: `PARTY${i}`,
					teamRowName: `Team ${i}`,
					teamColName: `Team ${i + 10}`,
				})
			);
			mockGetRecentParties.mockResolvedValue(parties);
			render(RecentParties);

			await vi.waitFor(() => {
				expect(screen.getByText('PARTY0')).toBeInTheDocument();
			});

			// Should show exactly 5 (the first 5)
			expect(screen.getByText('PARTY0')).toBeInTheDocument();
			expect(screen.getByText('PARTY4')).toBeInTheDocument();
			expect(screen.queryByText('PARTY5')).not.toBeInTheDocument();
		});
	});
});
