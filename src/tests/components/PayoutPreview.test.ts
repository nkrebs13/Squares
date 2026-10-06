import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import PayoutPreview from '$lib/components/forms/PayoutPreview.svelte';

describe('PayoutPreview', () => {
	it('renders the pot and one row per quarter using the testid prefix', () => {
		render(PayoutPreview, {
			splits: { q1: 10, q2: 20, q3: 30, final: 40 },
			squarePrice: 5,
			testIdPrefix: 'demo',
		});

		expect(screen.getByTestId('demo-payout-preview')).toHaveTextContent('Pot $500');
		expect(screen.getByTestId('demo-payout-q1')).toHaveTextContent('$50');
		expect(screen.getByTestId('demo-payout-q2')).toHaveTextContent('$100');
		expect(screen.getByTestId('demo-payout-q3')).toHaveTextContent('$150');
		expect(screen.getByTestId('demo-payout-final')).toHaveTextContent('$200');
		expect(screen.getByTestId('demo-payout-final')).toHaveTextContent('40%');
	});
});
