import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import PayoutSplitEditor from './PayoutSplitEditorHarness.svelte';

function renderEditor(variant: 'create' | 'admin') {
	return render(PayoutSplitEditor, { variant });
}

describe('PayoutSplitEditor — create variant', () => {
	it('shows static percentages for a non-custom preset', () => {
		renderEditor('create');
		expect(document.getElementById('split-q1')).toHaveTextContent('10%');
		expect(document.getElementById('split-final')).toHaveTextContent('40%');
		expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
	});

	it('applies a preset when its button is clicked', async () => {
		renderEditor('create');
		await fireEvent.click(screen.getByRole('button', { name: 'Equal' }));
		expect(document.getElementById('split-q1')).toHaveTextContent('25%');
		expect(document.getElementById('split-final')).toHaveTextContent('25%');
	});

	it('reveals four 0-100 inputs under Custom, starting at 25/25/25/25', async () => {
		renderEditor('create');
		await fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

		const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
		expect(inputs).toHaveLength(4);
		expect(inputs.map((i) => i.value)).toEqual(['25', '25', '25', '25']);
		for (const input of inputs) {
			expect(input.min).toBe('0');
			expect(input.max).toBe('100');
		}
	});

	it('remembers hand-entered custom values across preset switches', async () => {
		renderEditor('create');
		await fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
		await fireEvent.input(screen.getByLabelText('Q1 prize split percentage'), {
			target: { value: '40' },
		});
		await fireEvent.click(screen.getByRole('button', { name: 'Equal' }));
		await fireEvent.click(screen.getByRole('button', { name: 'Custom' }));

		expect((screen.getByLabelText('Q1 prize split percentage') as HTMLInputElement).value).toBe(
			'40'
		);
	});

	it('flags a split that does not total 100%', async () => {
		renderEditor('create');
		await fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
		await fireEvent.input(screen.getByLabelText('Q1 prize split percentage'), {
			target: { value: '30' },
		});

		expect(screen.getByText('Split must total 100% (currently 105%)')).toBeInTheDocument();
	});
});

describe('PayoutSplitEditor — admin variant', () => {
	it('always renders editable inputs with the current values and a valid total', () => {
		renderEditor('admin');
		const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
		expect(inputs.map((i) => i.value)).toEqual(['10', '20', '30', '40']);
		expect(screen.getByText(/Total: 100%/)).toHaveTextContent('✓');
	});

	it('copies preset values into the inputs', async () => {
		renderEditor('admin');
		await fireEvent.click(screen.getByRole('button', { name: 'Big Finish' }));
		const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
		expect(inputs.map((i) => i.value)).toEqual(['20', '20', '20', '40']);
	});

	it('keeps current values when Custom is picked', async () => {
		renderEditor('admin');
		await fireEvent.click(screen.getByRole('button', { name: 'Custom' }));
		const inputs = screen.getAllByRole('spinbutton') as HTMLInputElement[];
		expect(inputs.map((i) => i.value)).toEqual(['10', '20', '30', '40']);
	});

	it('switches to Custom and shows the failing total after an edit', async () => {
		renderEditor('admin');
		const q1 = document.getElementById('split-q1') as HTMLInputElement;
		await fireEvent.input(q1, { target: { value: '15' } });
		await fireEvent.change(q1);

		expect(screen.getByText(/Total: 105% \(must be 100%\)/)).toBeInTheDocument();
		expect(screen.getByTestId('harness-preset')).toHaveTextContent('Custom');
		expect(JSON.parse(screen.getByTestId('harness-splits').textContent ?? '{}').q1).toBe(15);
		expect(screen.getByRole('button', { name: 'Custom' })).toHaveClass('btn-primary');
	});
});
