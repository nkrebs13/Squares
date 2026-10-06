import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PayoutPresetButtons from '$lib/components/forms/PayoutPresetButtons.svelte';
import { SPLIT_PRESETS } from '$lib/types';

describe('PayoutPresetButtons', () => {
	it('renders one button per preset and highlights the selected one', () => {
		render(PayoutPresetButtons, { selected: SPLIT_PRESETS[1].name, onselect: vi.fn() });

		for (const preset of SPLIT_PRESETS) {
			const button = screen.getByRole('button', { name: preset.name });
			expect(button).toHaveClass(
				preset.name === SPLIT_PRESETS[1].name ? 'btn-primary' : 'btn-secondary'
			);
		}
	});

	it('reports the clicked preset', async () => {
		const onselect = vi.fn();
		render(PayoutPresetButtons, { selected: SPLIT_PRESETS[0].name, onselect });

		await fireEvent.click(screen.getByRole('button', { name: SPLIT_PRESETS[2].name }));

		expect(onselect).toHaveBeenCalledWith(SPLIT_PRESETS[2]);
	});
});
