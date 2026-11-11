import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Modal from '$lib/components/forms/Modal.svelte';

const body = createRawSnippet(() => ({ render: () => '<p id="d">Body</p>' }));

function renderModal(open: boolean, ondismiss = vi.fn()) {
	const view = render(Modal, {
		props: { open, labelledBy: 't', describedBy: 'd', ondismiss, children: body },
	});
	const dialog = view.container.ownerDocument.querySelector('dialog') as HTMLDialogElement;
	return { ...view, dialog, ondismiss };
}

describe('Modal', () => {
	it('dismisses on Escape (cancel) and on a backdrop click', () => {
		const { dialog, ondismiss } = renderModal(true);
		dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
		dialog.dispatchEvent(new MouseEvent('click', { bubbles: true }));
		expect(ondismiss).toHaveBeenCalledTimes(2);
	});

	it('dismisses when the browser closes it natively while still open', () => {
		const { dialog, ondismiss } = renderModal(true);
		dialog.dispatchEvent(new Event('close'));
		expect(ondismiss).toHaveBeenCalledTimes(1);
	});

	it('does not dismiss when the parent closes it', async () => {
		const { dialog, ondismiss, rerender } = renderModal(true);
		await rerender({ open: false });
		dialog.dispatchEvent(new Event('close'));
		expect(ondismiss).not.toHaveBeenCalled();
	});
});
