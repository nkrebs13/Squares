import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Harness from './TeamMatchupPickerHarness.svelte';

function state() {
	return JSON.parse(screen.getByTestId('harness-state').textContent ?? '{}');
}

describe('TeamMatchupPicker', () => {
	it('swaps names, colors and preset ids between the two sides', async () => {
		render(Harness, { rowName: 'Alpha', colName: 'Bravo' });

		await fireEvent.click(screen.getByRole('button', { name: 'Swap' }));

		expect(state().row).toMatchObject({ name: 'Bravo', color: '#222222' });
		expect(state().col).toMatchObject({ name: 'Alpha', color: '#111111' });
	});

	it('shows the matchup preview for two distinct teams', () => {
		render(Harness, { rowName: 'Alpha', colName: 'Bravo' });

		expect(screen.getByText('Matchup preview')).toBeInTheDocument();
		expect(screen.getByText('Alpha vs Bravo')).toBeInTheDocument();
		expect(screen.queryByText(/Choose two different teams/)).not.toBeInTheDocument();
	});

	it('shows the same-team error instead of the preview', () => {
		render(Harness, { rowName: 'Alpha', colName: ' alpha ' });

		expect(screen.getByText('Choose two different teams for the matchup.')).toBeInTheDocument();
		expect(screen.queryByText('Matchup preview')).not.toBeInTheDocument();
	});

	it('shows neither message until both teams are named', () => {
		render(Harness, { rowName: 'Alpha', colName: '' });

		expect(screen.queryByText('Matchup preview')).not.toBeInTheDocument();
		expect(screen.queryByText(/Choose two different teams/)).not.toBeInTheDocument();
	});

	it('gives each side uniquely prefixed ids', () => {
		render(Harness, { rowName: 'Alpha', colName: 'Bravo' });

		expect(document.getElementById('t-row-name')).toBeInTheDocument();
		expect(document.getElementById('t-col-name')).toBeInTheDocument();
	});
});
