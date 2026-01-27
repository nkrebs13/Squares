<script lang="ts">
	import { goto } from '$app/navigation';
	import RecentParties from '$lib/components/RecentParties.svelte';

	let partyCode = $state('');

	function handleJoin() {
		if (partyCode.trim().length >= 4) {
			goto(`/join?code=${partyCode.trim().toUpperCase()}`);
		}
	}
</script>

<div class="min-h-screen flex flex-col items-center justify-center p-6">
	<div class="text-center mb-12 animate-fade-in">
		<h1 class="text-5xl font-bold mb-3">
			<span class="team-row-text">Football</span>
			<span class="team-col-text">Squares</span>
		</h1>
		<p class="text-lg" style="color: var(--text-secondary)">Super Bowl party pools made easy</p>
	</div>

	<div class="w-full max-w-sm space-y-4 animate-scale-in">
		<a href="/create" class="btn btn-primary w-full block text-center">
			Create Party
		</a>

		<div class="flex items-center gap-4">
			<div class="flex-1 divider"></div>
			<span class="text-sm" style="color: var(--text-muted)">or</span>
			<div class="flex-1 divider"></div>
		</div>

		<form onsubmit={(e) => { e.preventDefault(); handleJoin(); }} class="space-y-3">
			<input
				type="text"
				bind:value={partyCode}
				placeholder="Enter party code"
				class="input text-center text-xl tracking-widest uppercase"
				maxlength="6"
				autocomplete="off"
				autocapitalize="characters"
			/>
			<button
				type="submit"
				class="btn btn-secondary w-full"
				disabled={partyCode.trim().length < 4}
			>
				Join Party
			</button>
		</form>
	</div>

	<RecentParties />
</div>
