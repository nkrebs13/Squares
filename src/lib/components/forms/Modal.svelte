<script lang="ts">
	import type { Snippet } from 'svelte';

	// A native <dialog> (focus trap, backdrop, Escape) driven by `open`.
	// `ondismiss` fires only when the user dismisses it (Escape or a backdrop
	// click), never when the parent closes it by setting `open` to false, so a
	// successful action that closes the dialog cannot run the cancel path.
	interface Props {
		open: boolean;
		/** Ids of the title and description elements inside `children`. */
		labelledBy: string;
		describedBy: string;
		ondismiss: () => void;
		/** Focused when the dialog opens. */
		initialFocus?: () => HTMLElement | null | undefined;
		/**
		 * Evaluated when the dialog closes. Return an element to focus instead of
		 * the element that opened it (e.g. when that trigger no longer exists).
		 */
		returnFocus?: () => HTMLElement | null | undefined;
		children: Snippet;
	}

	const { open, labelledBy, describedBy, ondismiss, initialFocus, returnFocus, children }: Props =
		$props();

	let dialogEl: HTMLDialogElement | null = null;
	let triggerEl: HTMLElement | null = null;

	$effect(() => {
		if (open) {
			if (dialogEl && !dialogEl.open) {
				triggerEl = document.activeElement as HTMLElement | null;
				dialogEl.showModal();
				initialFocus?.()?.focus();
			}
		} else if (dialogEl?.open) {
			dialogEl.close();
			const override = returnFocus?.();
			(override !== undefined ? override : triggerEl)?.focus();
			triggerEl = null;
		}
	});
</script>

<!-- Kept at the top level (not inside a block) so bind:this stays stable:
     https://svelte.dev/e/non_reactive_update -->
<dialog
	bind:this={dialogEl}
	aria-labelledby={labelledBy}
	aria-describedby={describedBy}
	oncancel={(e) => {
		e.preventDefault();
		ondismiss();
	}}
	onclose={() => {
		// A native close the parent didn't ask for (some browsers close on
		// Escape without a cancelable 'cancel'); a programmatic close has open=false.
		if (open) ondismiss();
	}}
	onclick={(e) => {
		if (e.target === dialogEl) ondismiss();
	}}
	class="modal"
>
	{#if open}
		{@render children()}
	{/if}
</dialog>

<style>
	.modal {
		background: transparent;
		border: none;
		padding: 1rem;
		max-width: min(calc(100vw - 2rem), 24rem);
		width: 100%;
		margin: auto;
	}

	.modal::backdrop {
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}
</style>
