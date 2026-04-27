<script lang="ts">
	import { goto } from '$app/navigation';
	import { SPLIT_PRESETS, type SplitPreset } from '$lib/types';
	import { userName } from '$lib/stores/user';
	import { setHostPin } from '$lib/storage';
	import { formatPrice, isValidUsdAmount, parseUsdAmount } from '$lib/utils/format';
	import { createParty as createPartyService } from '$lib/services/createParty';

	let squarePriceInput = $state('1');
	const squarePrice = $derived(parseUsdAmount(squarePriceInput) ?? 0);
	const isValidPrice = $derived(isValidUsdAmount(squarePriceInput));
	let selectedPreset = $state<SplitPreset>(SPLIT_PRESETS[0]);
	const customSplit = $state({ q1: 25, q2: 25, q3: 25, final: 25 });
	let hostPin = $state('');
	let hostName = $state('');
	let nickname = $state('');
	let isCreating = $state(false);
	let error = $state<string | null>(null);

	const isCustom = $derived(selectedPreset.name === 'Custom');

	const currentSplit = $derived(
		isCustom
			? customSplit
			: {
					q1: selectedPreset.q1,
					q2: selectedPreset.q2,
					q3: selectedPreset.q3,
					final: selectedPreset.final,
				}
	);

	const splitTotal = $derived(
		currentSplit.q1 + currentSplit.q2 + currentSplit.q3 + currentSplit.final
	);
	const isValidSplit = $derived(splitTotal === 100);
	const isValidPin = $derived(hostPin.length === 4 && /^\d+$/.test(hostPin));
	const isValidHostName = $derived(hostName.trim().length > 0);
	const canCreate = $derived(isValidSplit && isValidPin && isValidHostName && isValidPrice);

	async function createParty() {
		if (!canCreate || isCreating) return;

		isCreating = true;
		error = null;

		const result = await createPartyService({
			hostName: hostName.trim(),
			hostPin,
			squarePrice,
			splits: currentSplit,
		});

		if (!result.ok) {
			error = result.error;
			isCreating = false;
			return;
		}

		const code = result.party.code;

		// Persist PIN locally for host actions
		await setHostPin(code, hostPin);
		sessionStorage.setItem(`squares_pin_${code}`, hostPin);

		// Persist host name
		await userName.setName(hostName.trim());

		// Hand the party page an optional nickname for this code
		if (nickname.trim()) {
			sessionStorage.setItem(`squares_nickname_${code}`, nickname.trim());
		}

		goto(`/party/${code}`);
	}
</script>

<div class="min-h-screen p-6">
	<header class="mb-8">
		<a href="/" class="text-sm hover:opacity-100" style="color: var(--text-secondary)">← Back</a>
		<h1 class="text-3xl font-bold mt-2">Create Party</h1>
	</header>

	<form
		onsubmit={(e) => {
			e.preventDefault();
			createParty();
		}}
		class="space-y-6 max-w-md mx-auto"
	>
		<!-- Square Price -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Price per square</span>
				<div class="mt-2 flex items-center gap-2">
					<span class="text-2xl">$</span>
					<input
						type="text"
						inputmode="decimal"
						bind:value={squarePriceInput}
						class="input input-no-spinner text-2xl w-24"
						placeholder="0"
					/>
				</div>
				{#if !isValidPrice && squarePriceInput !== ''}
					<p class="mt-2 text-sm" style="color: #fca5a5">
						Enter a valid amount (e.g., 1, 5.50, 10)
					</p>
				{/if}
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Total pot: {formatPrice(squarePrice * 100)}
			</p>
		</div>

		<!-- Prize Split -->
		<div class="card">
			<span class="text-sm" style="color: var(--text-secondary)">Prize split</span>

			<div class="mt-3 grid grid-cols-4 gap-2">
				{#each SPLIT_PRESETS as preset (preset.name)}
					<button
						type="button"
						class="p-2 rounded-lg text-sm font-medium transition-all {selectedPreset.name ===
						preset.name
							? 'btn-primary'
							: 'btn-secondary'}"
						onclick={() => (selectedPreset = preset)}
					>
						{preset.name}
					</button>
				{/each}
			</div>

			<div class="mt-4 grid grid-cols-4 gap-3">
				{#each ['q1', 'q2', 'q3', 'final'] as quarter (quarter)}
					<div class="text-center">
						<label
							for="split-{quarter}"
							class="text-xs uppercase block"
							style="color: var(--text-muted)"
						>
							{quarter === 'final' ? 'Final' : quarter.toUpperCase()}
						</label>
						{#if isCustom}
							<input
								id="split-{quarter}"
								type="number"
								bind:value={customSplit[quarter as keyof typeof customSplit]}
								min="0"
								max="100"
								class="input mt-1 text-center p-2"
								aria-label="{quarter === 'final'
									? 'Final'
									: quarter.toUpperCase()} prize split percentage"
							/>
						{:else}
							<div id="split-{quarter}" class="mt-1 text-lg font-bold">
								{currentSplit[quarter as keyof typeof currentSplit]}%
							</div>
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
					onblur={() => (hostName = hostName.trim())}
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

		<!-- Game Nickname (optional) -->
		<div class="card">
			<label class="block">
				<span class="text-sm" style="color: var(--text-secondary)">Game Nickname</span>
				<span class="text-xs ml-1" style="color: var(--text-muted)">(optional)</span>
				<input
					type="text"
					bind:value={nickname}
					placeholder="e.g. Work Pool, Family Game"
					class="input mt-2"
					maxlength="30"
				/>
			</label>
			<p class="mt-2 text-sm" style="color: var(--text-muted)">
				Helps you tell games apart if you're in multiple pools
			</p>
		</div>

		{#if error}
			<div class="message-error">
				{error}
			</div>
		{/if}

		<button type="submit" class="btn btn-primary w-full" disabled={!canCreate || isCreating}>
			{isCreating ? 'Creating...' : 'Create Party'}
		</button>
	</form>
</div>
