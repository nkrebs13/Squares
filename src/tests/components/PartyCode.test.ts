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
		event_name: 'Test Football Squares',
		kickoff_at: null,
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
				title: 'Test Football Squares',
				text: 'Join Test Football Squares: Eagles vs Chiefs. Code TEST123.',
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

	describe('QR Code', () => {
		it('toggles QR code display and generates QR data URL', async () => {
			const QRCode = await import('qrcode');
			(QRCode.default.toDataURL as ReturnType<typeof vi.fn>).mockResolvedValue(
				'data:image/png;base64,mock'
			);
			party.set(createMockParty());
			render(PartyCode);

			// Click QR Code button to show
			await fireEvent.click(screen.getByText('QR Code'));

			await vi.waitFor(() => {
				expect(QRCode.default.toDataURL).toHaveBeenCalled();
				expect(screen.getByAltText('QR code to join party')).toBeInTheDocument();
				expect(screen.getByText('Hide QR')).toBeInTheDocument();
			});
		});

		it('hides QR code when toggled off', async () => {
			const QRCode = await import('qrcode');
			(QRCode.default.toDataURL as ReturnType<typeof vi.fn>).mockResolvedValue(
				'data:image/png;base64,mock'
			);
			party.set(createMockParty());
			render(PartyCode);

			// Show QR
			await fireEvent.click(screen.getByText('QR Code'));
			await vi.waitFor(() => {
				expect(screen.getByAltText('QR code to join party')).toBeInTheDocument();
			});

			// Hide QR
			await fireEvent.click(screen.getByText('Hide QR'));
			expect(screen.queryByAltText('QR code to join party')).not.toBeInTheDocument();
			expect(screen.getByText('QR Code')).toBeInTheDocument();
		});

		it('handles QR generation failure gracefully', async () => {
			const QRCode = await import('qrcode');
			vi.mocked(QRCode.default.toDataURL).mockRejectedValueOnce(new Error('QR failed'));
			const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

			party.set(createMockParty());
			render(PartyCode);

			await fireEvent.click(screen.getByText('QR Code'));

			await vi.waitFor(() => {
				expect(consoleSpy).toHaveBeenCalledWith('QR generation failed:', expect.any(Error));
			});

			// QR image should not be shown
			expect(screen.queryByAltText('QR code to join party')).not.toBeInTheDocument();
			consoleSpy.mockRestore();
		});
	});

	describe('Error Handling', () => {
		it('handles clipboard writeText rejection on Copy Code', async () => {
			party.set(createMockParty());
			const mockWriteText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				configurable: true,
			});

			render(PartyCode);
			// Should not throw
			await fireEvent.click(screen.getByText('Copy Code'));

			await vi.waitFor(() => {
				expect(mockWriteText).toHaveBeenCalled();
			});
			// Button should still show "Copy Code" (not "Copied!")
			expect(screen.getByText('Copy Code')).toBeInTheDocument();
		});

		it('handles clipboard writeText rejection on Copy Link', async () => {
			party.set(createMockParty());
			const mockWriteText = vi.fn().mockRejectedValue(new Error('Clipboard denied'));
			Object.defineProperty(navigator, 'clipboard', {
				value: { writeText: mockWriteText },
				configurable: true,
			});

			render(PartyCode);
			await fireEvent.click(screen.getByText('Copy Link'));

			await vi.waitFor(() => {
				expect(mockWriteText).toHaveBeenCalled();
			});
			expect(screen.getByText('Copy Link')).toBeInTheDocument();
		});

		it('handles navigator.share throwing (user cancelled)', async () => {
			party.set(createMockParty());
			const mockShare = vi.fn().mockRejectedValue(new Error('User cancelled'));
			Object.defineProperty(navigator, 'share', {
				value: mockShare,
				writable: true,
				configurable: true,
			});

			render(PartyCode);
			// Should not throw
			await fireEvent.click(screen.getByText('Share'));

			await vi.waitFor(() => {
				expect(mockShare).toHaveBeenCalled();
			});
		});
	});
});
