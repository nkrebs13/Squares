<script lang="ts">
	import { goto } from '$app/navigation';
	import { getSupabaseClient } from '$lib/supabase';
	import { SPLIT_PRESETS, DEFAULT_TEAMS, type SplitPreset } from '$lib/types';
	import { userName } from '$lib/stores/user';
	import { setHostPin } from '$lib/storage';

	let squarePrice = $state(1);
	let selectedPreset = $state<SplitPreset>(SPLIT_PRESETS[0]);
	let customSplit = $state({ q1: 25, q2: 25, q3: 25, final: 25 });
	let hostPin = $state('');
	let hostName = $state('');
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	let isCustom = $derived(selectedPreset.name === 'Custom');

	let currentSplit = $derived(
		isCustom
			? customSplit
			: { q1: selectedPreset.q1, q2: selectedPreset.q2, q3: selectedPreset.q3, final: selectedPreset.final }
	);

	let splitTotal = $derived(currentSplit.q1 + currentSplit.q2 + currentSplit.q3 + currentSplit.final);
	let isValidSplit = $derived(splitTotal === 100);
	let isValidPin = $derived(hostPin.length === 4 && /^\d+$/.test(hostPin));
	let isValidHostName = $derived(hostName.trim().length > 0);
	let canCreate = $derived(isValidSplit && isValidPin && isValidHostName && squarePrice >= 0);

	function generateCode(): string {
		const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
		let code = '';
		for (let i = 0; i < 5; i++) {
			code += chars[Math.floor(Math.random() * chars.length)];
		}
		return code;
	}

	async function createParty() {
		if (!canCreate || isCreating) return;

		isCreating = true;
		error = null;

		try {
			const supabase = getSupabaseClient();
			const code = generateCode();

			// Create party
			const { data: partyData, error: partyError } = await supabase
				.from('parties')
				.insert({
					code,
					host_pin: hostPin,
					host_name_lower: hostName.trim().toLowerCase(),
					square_price: squarePrice,
					split_q1: currentSplit.q1,
					split_q2: currentSplit.q2,
					split_q3: currentSplit.q3,
					split_final: currentSplit.final,
					status: 'filling',
					team_row_name: DEFAULT_TEAMS.row.name,
					team_col_name: DEFAULT_TEAMS.col.name,
					team_row_color: DEFAULT_TEAMS.row.color,
					team_col_color: DEFAULT_TEAMS.col.color,
					expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
				})
				.select()
				.single();

			if (partyError || !partyData) {
				throw new Error(partyError?.message || 'Failed to create party');
			}

			// Create 100 empty squares
			const squares = [];
			for (let row = 0; row < 10; row++) {
				for (let col = 0; col < 10; col++) {
					squares.push({
						party_id: partyData.id,
						row_num: row,
						col_num: col
					});
				}
			}

			const { error: squaresError } = await supabase.from('squares').insert(squares);

			if (squaresError) {
				// Cleanup party if squares failed
				await supabase.from('parties').delete().eq('id', partyData.id);
				throw new Error('Failed to create grid');
			}

			// Create empty scores record
			await supabase.from('scores').insert({ party_id: partyData.id });

			// Store PIN in IndexedDB and session storage for this party
			await setHostPin(code, hostPin);
			sessionStorage.setItem(`squares_pin_${code}`, hostPin);

			// Store host name
			await userName.setName(hostName.trim());

			goto(`/party/${code}`);
		} catch (e) {
			error = e instanceof Error ? e.message : 'Something went wrong';
		} finally {
			isCreating = false;
		}
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Back</a>
		<h1 class="text-3xl font-bold mt-2">Create Party</h1>
	</header>

	<form
		onsubmit={(e) => { e.preventDefault(); createParty(); }}
		class="space-y-6 max-w-md mx-auto"
	>
		<!-- Square Price -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Price per square</span>
				<div class="mt-2 flex items-center gap-2">
					<span class="text-2xl">$</span>
					<input
						type="number"
						bind:value={squarePrice}
						min="0"
						step="0.5"
						class="input text-2xl w-24"
					/>
				</div>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Total pot: ${(squarePrice * 100).toFixed(0)}
			</p>
		</div>

		<!-- Prize Split -->
		<div class="card">
			<span class="text-sm" style="color: var(--text-secondary)">Prize split</span>

			<div class="mt-3 grid grid-cols-4 gap-2">
				{#each SPLIT_PRESETS as preset}
					<button
						type="button"
						class="p-2 rounded-lg text-sm font-medium transition-all {selectedPreset.name === preset.name
							? 'btn-primary'
							: 'btn-secondary'}"
						onclick={() => (selectedPreset = preset)}
					>
						{preset.name}
					</button>
				{/each}
			</div>

			<div class="mt-4 grid grid-cols-4 gap-3">
				{#each ['q1', 'q2', 'q3', 'final'] as quarter}
					<div class="text-center">
						<div class="text-xs uppercase" style="color: var(--text-muted)">{quarter === 'final' ? 'Final' : quarter.toUpperCase()}</div>
						{#if isCustom}
							<input
								type="number"
								bind:value={customSplit[quarter as keyof typeof customSplit]}
								min="0"
								max="100"
								class="input mt-1 text-center p-2"
							/>
						{:else}
							<div class="mt-1 text-lg font-bold">{currentSplit[quarter as keyof typeof currentSplit]}%</div>
						{/if}
					</div>
				{/each}
			</div>

			{#if !isValidSplit}
				<p class="mt-3 text-sm" style="color: #fca5a5">
					Split must total 100% (currently {splitTotal}%)
				</p>
			{/if}
		</div>

		<!-- Host Name -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Your Name (Host)</span>
				<input
					type="text"
					bind:value={hostName}
					placeholder="Enter your name"
					class="input mt-2"
					maxlength="20"
					autocomplete="name"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				This name will be PIN-protected so only you can use it
			</p>
		</div>

		<!-- Host PIN -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Choose your PIN (4 digits)</span>
				<input
					type="tel"
					bind:value={hostPin}
					placeholder="0000"
					maxlength="4"
					pattern="[0-9]*"
					inputmode="numeric"
					class="input mt-2 text-center text-2xl tracking-widest"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				You'll need this to lock the grid and manage scores
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
			disabled={!canCreate || isCreating}
		>
			{isCreating ? 'Creating...' : 'Create Party'}
		</button>
	</form>
</div>
