<script lang="ts">
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';

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
		/** See Modal's `returnFocus`. */
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

	// $state: bound inside the dialog body, which exists only while open.
	let cancelBtn = $state<HTMLButtonElement | null>(null);
</script>

<Modal
	{open}
	labelledBy="{idPrefix}-title"
	describedBy="{idPrefix}-description"
	ondismiss={oncancel}
	initialFocus={() => cancelBtn}
	returnFocus={closeFocusTarget}
>
	<div class="card max-w-sm w-full" style="background: var(--bg-secondary);">
		<h3 id="{idPrefix}-title" class="text-lg font-semibold mb-2 text-red-400">{title}</h3>
		<p id="{idPrefix}-description" class="text-sm mb-4 {descriptionClass}">
			{@render children()}
		</p>
		<div class="flex gap-2">
			<!-- Cancel takes focus first, so a stray Enter can't confirm a destructive action. -->
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
</Modal>
