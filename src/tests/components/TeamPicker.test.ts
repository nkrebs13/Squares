import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { NFL_TEAM_PRESETS } from '$lib/nflTeams';
import TeamPicker from '$lib/components/forms/TeamPicker.svelte';

const team = NFL_TEAM_PRESETS[0];

function renderPicker(overrides: Record<string, unknown> = {}) {
	return render(TeamPicker, {
		side: 'row',
		idPrefix: 'row',
		name: 'Custom Club',
		color: '#112233',
		presetId: '',
		...overrides,
	});
}

describe('TeamPicker', () => {
	it('labels the row side as the Left team and the col side as the Top team', () => {
		const { unmount } = renderPicker();
		expect(screen.getByLabelText('Left team NFL preset')).toBeInTheDocument();
		expect(screen.getByLabelText('Left team color picker')).toBeInTheDocument();
		unmount();

		renderPicker({ side: 'col', idPrefix: 'col' });
		expect(screen.getByLabelText('Top team NFL preset')).toBeInTheDocument();
		expect(screen.getByLabelText('Top team color picker')).toBeInTheDocument();
	});

	it('applies an NFL preset to the name, color and preset id', async () => {
		renderPicker();
		const select = screen.getByLabelText('Left team NFL preset') as HTMLSelectElement;

		await fireEvent.change(select, { target: { value: team.id } });

		expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe(team.name);
		expect((screen.getByLabelText('Left team color picker') as HTMLInputElement).value).toBe(
			team.color.toLowerCase()
		);
		expect(select.value).toBe(team.id);
	});

	it('resets the preset to custom when the name is edited by hand', async () => {
		renderPicker({ name: team.name, color: team.color, presetId: team.id });
		const select = screen.getByLabelText('Left team NFL preset') as HTMLSelectElement;
		expect(select.value).toBe(team.id);

		await fireEvent.input(screen.getByRole('textbox'), { target: { value: 'Someone Else' } });

		expect(select.value).toBe('');
	});

	it('trims the team name on blur', async () => {
		renderPicker({ name: '  Padded  ' });
		const input = screen.getByRole('textbox') as HTMLInputElement;

		await fireEvent.blur(input);

		expect(input.value).toBe('Padded');
	});

	it('prefixes element ids so two pickers can coexist on one page', () => {
		render(TeamPicker, { side: 'row', idPrefix: 'a', name: '', color: '#000000', presetId: '' });
		render(TeamPicker, { side: 'col', idPrefix: 'b', name: '', color: '#000000', presetId: '' });

		const ids = Array.from(document.querySelectorAll('[id]')).map((el) => el.id);
		expect(ids).toEqual(expect.arrayContaining(['a-name', 'b-name', 'a-preset', 'b-preset']));
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('uses compact copy and a 30-char limit in the create variant', () => {
		renderPicker({ variant: 'create', placeholder: 'e.g. Chiefs' });
		const input = screen.getByRole('textbox') as HTMLInputElement;
		expect(input.maxLength).toBe(30);
		expect(input.placeholder).toBe('e.g. Chiefs');
		expect(screen.getByText('NFL preset')).toBeInTheDocument();
	});

	it('uses inline copy and a 50-char limit in the admin variant', () => {
		renderPicker({ variant: 'admin' });
		expect((screen.getByRole('textbox') as HTMLInputElement).maxLength).toBe(50);
		expect(screen.getByText('Left team NFL preset', { selector: 'span' })).toBeInTheDocument();
	});
});
