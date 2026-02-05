import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';

vi.mock('qrcode', () => ({
	default: {
		toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,mock'),
	},
}));

import PartyCode from '$lib/components/PartyCode.svelte';
import { party } from '$lib/stores/game';
import type { Party } from '$lib/types';

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
		status: 'filling',
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

describe('PartyCode Component', () => {
	const originalClipboard = navigator.clipboard;
	const originalShare = navigator.share;

	beforeEach(() => {
		party.set(null);
		vi.clearAllMocks();
	});

	afterEach(() => {
		// Restore original navigator properties
		Object.defineProperty(navigator, 'clipboard', {
			value: originalClipboard,
			writable: true,
			configurable: true,
		});
		Object.defineProperty(navigator, 'share', {
			value: originalShare,
			writable: true,
			configurable: true,
		});
	});

	it('renders nothing when party is null', () => {
		const { container } = render(PartyCode);
		expect(container.innerHTML).toBe('<!---->');
	});

	it('displays party code text', () => {
		party.set(createMockParty());
		render(PartyCode);
		expect(screen.getByText('TEST123')).toBeInTheDocument();
	});

	it('displays "Party Code" label', () => {
		party.set(createMockParty());
		render(PartyCode);
		expect(screen.getByText('Party Code')).toBeInTheDocument();
	});

	it('shows Copy Code, Copy Link, Share, and QR Code buttons', () => {
		party.set(createMockParty());
		render(PartyCode);
		expect(screen.getByText('Copy Code')).toBeInTheDocument();
		expect(screen.getByText('Copy Link')).toBeInTheDocument();
		expect(screen.getByText('Share')).toBeInTheDocument();
		expect(screen.getByText('QR Code')).toBeInTheDocument();
	});

	it('Copy Code button calls clipboard writeText with code', async () => {
		party.set(createMockParty());
		const mockWriteText = vi.fn().mockResolvedValue(undefined);

		// Mock clipboard on the navigator object
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: mockWriteText },
			configurable: true,
		});

		render(PartyCode);
		await fireEvent.click(screen.getByText('Copy Code'));

		// Allow async handler to complete
		await vi.waitFor(() => {
			expect(mockWriteText).toHaveBeenCalledWith('TEST123');
		});
	});

	it('Share button calls navigator.share when available', async () => {
		party.set(createMockParty());
		const mockShare = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'share', {
			value: mockShare,
			writable: true,
			configurable: true,
		});

		render(PartyCode);
		const user = userEvent.setup();
		await user.click(screen.getByText('Share'));

		expect(mockShare).toHaveBeenCalledWith(
			expect.objectContaining({
				title: 'Football Squares',
				text: 'Join my Football Squares party!',
			})
		);
	});

	it('falls back to copy link when share is not available', async () => {
		party.set(createMockParty());
		Object.defineProperty(navigator, 'share', {
			value: undefined,
			configurable: true,
		});
		const mockWriteText = vi.fn().mockResolvedValue(undefined);
		Object.defineProperty(navigator, 'clipboard', {
			value: { writeText: mockWriteText },
			configurable: true,
		});

		render(PartyCode);
		await fireEvent.click(screen.getByText('Share'));

		await vi.waitFor(() => {
			expect(mockWriteText).toHaveBeenCalledWith(expect.stringContaining('/join?code=TEST123'));
		});
	});
});
