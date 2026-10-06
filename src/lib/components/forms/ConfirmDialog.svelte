<script lang="ts">
	import type { Snippet } from 'svelte';

	interface Props {
		open: boolean;
		/** Prefix for the generated `{idPrefix}-title` / `{idPrefix}-description` ids. */
		idPrefix: string;
		title: string;
		descriptionClass?: string;
		confirmLabel: string;
		busyLabel: string;
		busy?: boolean;
		/** Dialog body (rendered inside the description paragraph). */
		children: Snippet;
		onconfirm: () => void;
		/** Called on Cancel, Escape, or a backdrop click. The parent should set `open` to false. */
		oncancel: () => void;
		/**
		 * Evaluated when the dialog closes. Return an element to focus instead of the
		 * element that opened the dialog (e.g. when that trigger no longer exists).
		 */
		closeFocusTarget?: () => HTMLElement | null | undefined;
	}

	const {
		open,
		idPrefix,
		title,
		descriptionClass = 'text-secondary',
		confirmLabel,
		busyLabel,
		busy = false,
		children,
		onconfirm,
		oncancel,
		closeFocusTarget,
	}: Props = $props();

	let dialogEl: HTMLDialogElement | null = null;
	// $state: bound inside the {#if open} block, so the element is created and
	// destroyed on each open/close.
	let cancelBtn = $state<HTMLButtonElement | null>(null);
	let triggerEl: HTMLElement | null = null;

	// Native <dialog> for real focus trapping, backdrop, and Escape handling.
	$effect(() => {
		if (open) {
			if (dialogEl && !dialogEl.open) {
				triggerEl = document.activeElement as HTMLElement | null;
				dialogEl.showModal();
				// Focus Cancel first, never the destructive action, so a stray
				// Enter keypress can't trigger it.
				cancelBtn?.focus();
			}
		} else {
			if (dialogEl?.open) dialogEl.close();
			const override = closeFocusTarget?.();
			if (override !== undefined) {
				triggerEl = null;
				override?.focus();
			} else {
				triggerEl?.focus();
				triggerEl = null;
			}
		}
	});
</script>

<!-- Kept at the component's top level (not nested inside an {#if}/{#each}/{#await}/
     {#key} block) so bind:this stays a stable reference — see
     https://svelte.dev/e/non_reactive_update. -->
<dialog
	bind:this={dialogEl}
	aria-labelledby="{idPrefix}-title"
	aria-describedby="{idPrefix}-description"
	onclose={oncancel}
	onclick={(e) => {
		if (e.target === dialogEl) oncancel();
	}}
	class="confirm-dialog"
>
	{#if open}
		<div class="card max-w-sm w-full" style="background: var(--bg-secondary);">
			<h3 id="{idPrefix}-title" class="text-lg font-semibold mb-2 text-red-400">{title}</h3>
			<p id="{idPrefix}-description" class="text-sm mb-4 {descriptionClass}">
				{@render children()}
			</p>
			<div class="flex gap-2">
				<button
					bind:this={cancelBtn}
					onclick={oncancel}
					class="btn btn-secondary flex-1"
					disabled={busy}
				>
					Cancel
				</button>
				<button onclick={onconfirm} class="btn btn-danger flex-1" disabled={busy}>
					{busy ? busyLabel : confirmLabel}
				</button>
			</div>
		</div>
	{/if}
</dialog>

<style>
	.confirm-dialog {
		background: transparent;
		border: none;
		padding: 1rem;
		max-width: min(calc(100vw - 2rem), 24rem);
		width: 100%;
		margin: auto;
	}

	.confirm-dialog::backdrop {
		background: rgba(0, 0, 0, 0.5);
		backdrop-filter: blur(4px);
		-webkit-backdrop-filter: blur(4px);
	}
</style>
