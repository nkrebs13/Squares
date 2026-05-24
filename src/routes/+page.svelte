<script lang="ts">
	import { goto } from '$app/navigation';
	import RecentParties from '$lib/components/RecentParties.svelte';
	import { APP_CONFIG } from '$lib/config';

	let partyCode = $state('');
	const demoHref = $derived(`/join?code=${APP_CONFIG.demoPartyCode.toUpperCase()}`);
	const canonicalUrl = $derived(APP_CONFIG.appUrl.replace(/\/$/, ''));

	const previewCells = [
		{ owner: 'NK', class: 'mine' },
		{ owner: 'AM', class: 'claimed' },
		{ owner: '', class: 'empty' },
		{ owner: 'JD', class: 'claimed' },
		{ owner: '', class: 'empty' },
		{ owner: 'Q1', class: 'winner' },
		{ owner: 'SL', class: 'claimed' },
		{ owner: '', class: 'empty' },
		{ owner: 'RT', class: 'claimed' },
		{ owner: '', class: 'empty' },
		{ owner: 'EV', class: 'claimed' },
		{ owner: '', class: 'empty' },
		{ owner: 'MC', class: 'claimed' },
		{ owner: '', class: 'empty' },
		{ owner: 'PR', class: 'claimed' },
		{ owner: '', class: 'empty' },
	];

	function handleJoin() {
		if (partyCode.trim().length >= 4) {
			goto(`/join?code=${partyCode.trim().toUpperCase()}`);
		}
	}
</script>

<svelte:head>
	<title>{APP_CONFIG.appName} | Real-time football squares</title>
	<meta name="description" content={APP_CONFIG.appDescription} />
	<link rel="canonical" href={canonicalUrl} />
	<meta property="og:url" content={canonicalUrl} />
	<meta property="og:title" content={APP_CONFIG.appName} />
	<meta property="og:description" content={APP_CONFIG.appDescription} />
	<meta name="twitter:title" content={APP_CONFIG.appName} />
	<meta name="twitter:description" content={APP_CONFIG.appDescription} />
</svelte:head>

<div class="home-page">
	<section class="hero-shell" aria-labelledby="home-title">
		<div class="hero-copy animate-fade-in">
			<p class="eyebrow">Real-time football squares</p>
			<h1 id="home-title" class="logo-title">
				<span class="logo-gradient">{APP_CONFIG.appName}</span>
			</h1>
			<p class="tagline">{APP_CONFIG.appTagline}</p>
			<p class="intro">
				Run a live pool from one shared link. Friends claim cells in real time, hosts lock the grid,
				scores reveal winners, and everyone keeps the same source of truth.
			</p>

			<div class="hero-actions" aria-label="Primary actions">
				<a href="/create" class="btn btn-primary action-primary">Create Party</a>
				<a href={demoHref} class="btn btn-secondary action-secondary">Try Demo</a>
			</div>
		</div>

		<div class="join-panel animate-scale-in" aria-label="Join a party">
			<div class="panel-header">
				<p class="panel-kicker">Have a code?</p>
				<h2>Join a pool</h2>
			</div>

			<form
				onsubmit={(e) => {
					e.preventDefault();
					handleJoin();
				}}
				class="join-form"
			>
				<label class="sr-only" for="party-code-input">Party code</label>
				<input
					id="party-code-input"
					type="text"
					bind:value={partyCode}
					placeholder="Enter party code"
					class="input join-input"
					maxlength="6"
					autocomplete="off"
					autocapitalize="characters"
				/>
				<button
					type="submit"
					class="btn btn-primary join-button"
					disabled={partyCode.trim().length < 4}
				>
					Join Party
				</button>
			</form>

			<div class="preview" aria-hidden="true">
				<div class="preview-score">
					<span>{APP_CONFIG.defaultTeams.row.name}</span>
					<strong>17</strong>
					<span>{APP_CONFIG.defaultTeams.col.name}</span>
					<strong>14</strong>
				</div>
				<div class="preview-grid">
					{#each previewCells as cell, index (`${cell.owner}-${index}`)}
						<div class="preview-cell {cell.class}">{cell.owner}</div>
					{/each}
				</div>
			</div>
		</div>
	</section>

	<section class="trust-row" aria-label="Production highlights">
		<div>
			<strong>~50</strong>
			<span>live players</span>
		</div>
		<div>
			<strong>0</strong>
			<span>support requests</span>
		</div>
		<div>
			<strong>5</strong>
			<span>CI gates</span>
		</div>
	</section>

	<section class="recent-section" aria-label="Recent parties">
		<p class="recent-hint">Join multiple parties and they will all appear below.</p>
		<RecentParties />
	</section>
</div>

<style>
	.home-page {
		width: min(100%, 72rem);
		margin: 0 auto;
		padding: clamp(1.25rem, 3vw, 3rem);
		min-height: 100vh;
		display: flex;
		flex-direction: column;
		justify-content: center;
		gap: 1.5rem;
	}

	.hero-shell {
		display: grid;
		grid-template-columns: minmax(0, 1.15fr) minmax(19rem, 0.85fr);
		gap: clamp(1.25rem, 4vw, 4rem);
		align-items: center;
	}

	.hero-copy {
		max-width: 42rem;
	}

	.eyebrow,
	.panel-kicker {
		margin: 0 0 0.75rem;
		color: rgba(100, 210, 200, 0.95);
		font-size: 0.78rem;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0;
	}

	.logo-title {
		margin: 0;
		font-size: clamp(3rem, 7vw, 5.9rem);
		line-height: 0.92;
		font-weight: 800;
		letter-spacing: 0;
	}

	.tagline {
		margin: 1rem 0 0;
		color: var(--text-secondary);
		font-size: clamp(1.1rem, 2vw, 1.35rem);
		font-weight: 600;
	}

	.intro {
		margin: 1rem 0 0;
		max-width: 36rem;
		color: var(--text-secondary);
		font-size: 1rem;
		line-height: 1.7;
	}

	.hero-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	.action-primary,
	.action-secondary {
		min-width: 10rem;
		text-align: center;
		border-radius: 8px;
	}

	.join-panel {
		padding: 1rem;
		background:
			linear-gradient(180deg, rgba(255, 255, 255, 0.055), rgba(255, 255, 255, 0.025)),
			var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 8px;
		box-shadow: 0 18px 56px rgba(0, 0, 0, 0.26);
	}

	.panel-header {
		margin-bottom: 1rem;
	}

	.panel-header h2 {
		margin: 0;
		font-size: 1.5rem;
		font-weight: 750;
		letter-spacing: 0;
	}

	.join-form {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.75rem;
		align-items: stretch;
	}

	.join-input {
		text-align: center;
		font-size: 1.15rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
	}

	.join-button {
		border-radius: 8px;
		white-space: nowrap;
	}

	.preview {
		margin-top: 1rem;
		padding-top: 1rem;
		border-top: 1px solid var(--border-color);
	}

	.preview-score {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 0.25rem 0.75rem;
		align-items: center;
		color: var(--text-secondary);
		font-size: 0.82rem;
	}

	.preview-score strong {
		color: var(--text-primary);
		font-size: 1.2rem;
		font-variant-numeric: tabular-nums;
	}

	.preview-grid {
		display: grid;
		grid-template-columns: repeat(4, minmax(0, 1fr));
		gap: 0.35rem;
		margin-top: 0.9rem;
	}

	.preview-cell {
		aspect-ratio: 1;
		display: grid;
		place-items: center;
		border-radius: 6px;
		border: 1px solid var(--border-color);
		color: var(--text-primary);
		font-size: 0.72rem;
		font-weight: 700;
	}

	.preview-cell.empty {
		background: rgba(255, 255, 255, 0.055);
	}

	.preview-cell.claimed {
		background: rgba(100, 170, 230, 0.18);
		border-color: rgba(100, 170, 230, 0.28);
	}

	.preview-cell.mine {
		background: rgba(244, 143, 177, 0.2);
		border-color: rgba(244, 143, 177, 0.45);
	}

	.preview-cell.winner {
		background: rgba(100, 200, 130, 0.28);
		border-color: rgba(100, 200, 130, 0.6);
	}

	.trust-row {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.75rem;
	}

	.trust-row div {
		padding: 0.9rem;
		background: rgba(255, 255, 255, 0.035);
		border: 1px solid var(--border-color);
		border-radius: 8px;
	}

	.trust-row strong,
	.trust-row span {
		display: block;
	}

	.trust-row strong {
		font-size: 1.35rem;
		line-height: 1;
	}

	.trust-row span {
		margin-top: 0.35rem;
		color: var(--text-muted);
		font-size: 0.82rem;
	}

	.recent-section {
		display: flex;
		flex-direction: column;
		align-items: center;
	}

	.recent-hint {
		margin: 0;
		text-align: center;
		color: var(--text-muted);
		font-size: 0.9rem;
	}

	@media (max-width: 860px) {
		.home-page {
			justify-content: flex-start;
		}

		.hero-shell {
			grid-template-columns: 1fr;
		}

		.hero-copy {
			text-align: center;
			margin: 0 auto;
		}

		.intro {
			margin-left: auto;
			margin-right: auto;
		}

		.hero-actions {
			justify-content: center;
		}
	}

	@media (max-width: 520px) {
		.join-form,
		.trust-row {
			grid-template-columns: 1fr;
		}

		.action-primary,
		.action-secondary {
			width: 100%;
		}
	}
</style>
