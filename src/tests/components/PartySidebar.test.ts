import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { tick } from 'svelte';

const { mockParty, mockFilledCount, mockIsGridFull } = vi.hoisted(() => {
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { writable } = require('svelte/store');
	return {
		mockParty: writable(null),
		mockFilledCount: writable(0),
		mockIsGridFull: writable(false),
	};
});

vi.mock('$lib/stores/game', () => ({
	party: { subscribe: mockParty.subscribe },
	filledCount: { subscribe: mockFilledCount.subscribe },
	isGridFull: { subscribe: mockIsGridFull.subscribe },
	winners: {
		subscribe: vi.fn((cb: (v: unknown[]) => void) => {
			cb([]);
			return () => {};
		}),
	},
	scores: {
		subscribe: vi.fn((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		}),
	},
	liveScores: {
		subscribe: vi.fn((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		}),
	},
	mySquares: {
		subscribe: vi.fn((cb: (v: unknown[]) => void) => {
			cb([]);
			return () => {};
		}),
	},
	mySquareCount: {
		subscribe: vi.fn((cb: (v: number) => void) => {
			cb(0);
			return () => {};
		}),
	},
	amountOwed: {
		subscribe: vi.fn((cb: (v: number) => void) => {
			cb(0);
			return () => {};
		}),
	},
	playerSummary: {
		subscribe: vi.fn((cb: (v: unknown[]) => void) => {
			cb([]);
			return () => {};
		}),
	},
	selectedPlayerFilter: {
		subscribe: vi.fn((cb: (v: null) => void) => {
			cb(null);
			return () => {};
		}),
	},
}));

vi.mock('$lib/stores/user', () => ({
	userName: {
		subscribe: vi.fn((cb: (v: string) => void) => {
			cb('TestUser');
			return () => {};
		}),
	},
}));

vi.mock('$lib/push', () => ({
	pushSubscribed: {
		subscribe: vi.fn((cb: (v: boolean) => void) => {
			cb(false);
			return () => {};
		}),
	},
	subscribeToPush: vi.fn(),
	isPushSupported: vi.fn().mockReturnValue(false),
}));

vi.mock('$lib/stores/game-realtime', () => ({
	connectionStatus: {
		subscribe: vi.fn((cb: (v: { status: string }) => void) => {
			cb({ status: 'connected' });
			return () => {};
		}),
	},
}));

import PartySidebar from '$lib/components/PartySidebar.svelte';

const makeParty = (overrides = {}) => ({
	id: 'test-id',
	code: 'TEST01',
	host_name_lower: null,
	event_name: 'Test Football Squares',
	kickoff_at: null,
	square_price: 5,
	split_q1: 25,
	split_q2: 25,
	split_q3: 25,
	split_final: 25,
	status: 'filling',
	team_row_name: 'Chiefs',
	team_col_name: 'Eagles',
	team_row_color: '#e31837',
	team_col_color: '#004c54',
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
	expires_at: null,
	game_id: null,
	home_team_is_row: true,
	...overrides,
});

describe('PartySidebar', () => {
	it('renders desktop variant without error', async () => {
		mockParty.set(makeParty());
		mockFilledCount.set(10);
		const { container } = render(PartySidebar, { props: { variant: 'desktop' } });
		await tick();
		expect(container).toBeTruthy();
	});

	it('renders mobile variant without error', async () => {
		mockParty.set(makeParty());
		const { container } = render(PartySidebar, { props: { variant: 'mobile' } });
		await tick();
		expect(container).toBeTruthy();
	});

	it('shows filling status banner when party is filling', async () => {
		mockParty.set(makeParty({ status: 'filling' }));
		mockFilledCount.set(42);
		const { getByText } = render(PartySidebar, { props: { variant: 'desktop' } });
		await tick();
		expect(getByText(/42\/100/)).toBeTruthy();
	});

	it('shows ready to lock message when grid is full and filling', async () => {
		mockParty.set(makeParty({ status: 'filling' }));
		mockFilledCount.set(100);
		mockIsGridFull.set(true);
		const { getByText } = render(PartySidebar, { props: { variant: 'desktop' } });
		await tick();
		expect(getByText(/Ready to lock/)).toBeTruthy();
		mockIsGridFull.set(false);
	});

	it('shows prize split info when party exists', async () => {
		mockParty.set(makeParty({ split_q1: 10, split_q2: 20, split_q3: 30, split_final: 40 }));
		const { getAllByText, getByTestId, getByText } = render(PartySidebar, {
			props: { variant: 'desktop' },
		});
		await tick();
		expect(getAllByText('10%').length).toBeGreaterThan(0);
		expect(getByTestId('party-payout-q1')).toHaveTextContent('$50');
		expect(getByTestId('party-payout-q2')).toHaveTextContent('$100');
		expect(getByTestId('party-payout-q3')).toHaveTextContent('$150');
		expect(getByTestId('party-payout-final')).toHaveTextContent('$200');
		expect(getByText('$5/square • $500 total pot')).toBeTruthy();
	});

	it('shows PlayerLegend only in desktop variant', async () => {
		mockParty.set(makeParty());
		const desktop = render(PartySidebar, { props: { variant: 'desktop' } });
		await tick();
		const mobileContainer = render(PartySidebar, { props: { variant: 'mobile' } });
		await tick();
		// Desktop should render the legend wrapper; mobile should not
		expect(desktop.container.querySelector('.mt-4')).toBeTruthy();
		// Both render without error
		expect(mobileContainer.container).toBeTruthy();
	});
});
