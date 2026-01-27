<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { userName } from '$lib/stores/user';
	import { getSupabaseClient } from '$lib/supabase';
	import { onMount } from 'svelte';

	let code = $state('');
	let name = $state('');
	let isChecking = $state(false);
	let error = $state<string | null>(null);

	onMount(() => {
		const urlCode = $page.url.searchParams.get('code');
		if (urlCode) {
			code = urlCode.toUpperCase();
		}

		// Pre-fill name if we have one stored
		userName.subscribe((storedName) => {
			if (storedName && !name) {
				name = storedName;
			}
		});
	});

	async function handleJoin() {
		if (!code.trim() || !name.trim()) return;

		isChecking = true;
		error = null;

		try {
			const supabase = getSupabaseClient();

			// Check if party exists
			const { data: partyData, error: partyError } = await supabase
				.from('parties')
				.select('id, status')
				.eq('code', code.toUpperCase())
				.single();

			if (partyError || !partyData) {
				error = 'Party not found. Check the code and try again.';
				return;
			}

			// Save name and redirect to party
			userName.setName(name.trim());
			goto(`/party/${code.toUpperCase()}`);
		} catch (e) {
			error = 'Something went wrong. Please try again.';
		} finally {
			isChecking = false;
		}
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Back</a>
		<h1 class="text-3xl font-bold mt-2">Join Party</h1>
	</header>

	<form
		onsubmit={(e) => { e.preventDefault(); handleJoin(); }}
		class="space-y-6 max-w-md mx-auto"
	>
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Party Code</span>
				<input
					type="text"
					bind:value={code}
					placeholder="ABCD12"
					class="input mt-2 text-center text-2xl tracking-widest uppercase"
					maxlength="6"
					autocomplete="off"
					autocapitalize="characters"
				/>
			</label>
		</div>

		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Your Name</span>
				<input
					type="text"
					bind:value={name}
					placeholder="Enter your name"
					class="input mt-2"
					maxlength="20"
					autocomplete="name"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Use the same name to claim more squares later
			</p>
		</div>

		{#if error}
			<div class="message-error">
				{error}
			</div>
		{/if}

		<button
			type="submit"
			class="btn btn-primary w-full"
			disabled={!code.trim() || !name.trim() || isChecking}
		>
			{isChecking ? 'Joining...' : 'Join Party'}
		</button>
	</form>
</div>
