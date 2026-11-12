<script lang="ts">
	import { formatMatchup } from '$lib/utils/format';
	import { joinPath } from '$lib/utils/partyCode';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { DESKTOP_LAYOUT_QUERY } from '$lib/layout';
	import PageMeta from '$lib/components/PageMeta.svelte';
	import SimpleGrid from '$lib/components/SimpleGrid.svelte';
	import GridSkeleton from '$lib/components/GridSkeleton.svelte';
	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import BoundaryFallback from '$lib/components/BoundaryFallback.svelte';
	import PartySidebar from '$lib/components/PartySidebar.svelte';
	import { openParty, cleanup, party, teamTheme, isLoading, error } from '$lib/stores/game';
	import { userName } from '$lib/stores/user';
	import {
		buildPartyCanonicalUrl,
		buildPartyPageTitle,
		buildPartyShareDescription,
		partyToShareMetadata,
	} from '$lib/partyMeta';
	import { saveRecentParty } from '$lib/recentParties';
	import { isFilling } from '$lib/partyStatus';
	import { mayPlayAs, recallHostPin } from '$lib/hostPin';
	import type { RecentParty } from '$lib/types';
	import type { PartyShareMetadata } from '$lib/partyMeta';

	const { data = { partyMeta: null } } = $props<{
		data?: { partyMeta: PartyShareMetadata | null };
	}>();
	// Host PINs are stored under the upper-case code (the RPCs upper-case too), so a URL
	// typed in lower case still finds them. Not normalizePartyCode: no truncation here.
	const code = $derived(($page.params.code ?? '').toUpperCase());
	const matchupLabel = $derived(
		$party ? formatMatchup($party.team_row_name, $party.team_col_name) : ''
	);
	const shareMeta = $derived($party ? partyToShareMetadata($party) : data.partyMeta);
	const pageTitle = $derived(buildPartyPageTitle(shareMeta));
	const pageDescription = $derived(buildPartyShareDescription(shareMeta));
	const canonicalUrl = $derived(buildPartyCanonicalUrl(shareMeta?.code || code));

	let isHost = $state(false);
	let grid = $state<SimpleGrid>();
	const desktop = new MediaQuery(DESKTOP_LAYOUT_QUERY);

	async function checkIsHost() {
		isHost = (await recallHostPin(code)) !== null;
	}

	/** The status last written to the recent-parties entry (undefined until the first save). */
	let savedStatus: string | undefined;

	async function saveToRecentParties() {
		if (!$party) return;
		savedStatus = $party.status;

		const recentParty: RecentParty = {
			code: $party.code,
			eventName: $party.event_name,
			kickoffAt: $party.kickoff_at,
			teamRowName: $party.team_row_name,
			teamColName: $party.team_col_name,
			lastVisited: Date.now(),
			status: $party.status,
			isHost,
		};

		await saveRecentParty(recentParty);
	}

	onMount(async () => {
		if (!$userName) {
			goto(joinPath(code));
			return;
		}

		await checkIsHost();

		if (await openParty(code)) {
			// A shared or recent link skips the join form, so the host-name check happens here too.
			if (!(await mayPlayAs(code, $party?.host_name_lower ?? null, $userName))) {
				goto(joinPath(code));
				return;
			}
			await saveToRecentParties();
		}
	});

	// A lock or completion while the page is open must reach the saved entry too.
	$effect(() => {
		const status = $party?.status;
		if (status && savedStatus !== undefined && status !== savedStatus) void saveToRecentParties();
	});

	onDestroy(cleanup);
</script>

<PageMeta title={pageTitle} description={pageDescription} url={canonicalUrl} />

<div
	class="party-page"
	style:--team-row-color={$teamTheme.rowColor}
	style:--team-col-color={$teamTheme.colColor}
>
	<ConnectionBanner />
	{#if $isLoading}
		<div class="flex items-center justify-center h-screen">
			<GridSkeleton />
		</div>
	{:else if $error}
		<div class="flex flex-col items-center justify-center h-screen gap-4">
			<p class="text-error">{$error}</p>
			<a href="/" class="btn btn-secondary">Go Home</a>
		</div>
	{:else if $party}
		<header class="mb-4 flex justify-between items-start">
			<div>
				<a href="/" class="text-sm hover:opacity-100 text-secondary">← Home</a>
				<h1 class="text-2xl font-bold mt-1">
					{$party.event_name}
				</h1>
				<p class="mt-1 text-sm text-secondary">{matchupLabel}</p>
			</div>
			<div class="header-actions">
				{#if isHost}
					<a href="/party/{code}/admin" class="btn btn-secondary text-sm"> Host Panel </a>
				{/if}
				<!-- The gesture help teaches claiming, so it is offered only while the grid fills. -->
				{#if isFilling($party.status)}
					<button
						type="button"
						class="help-btn"
						onclick={() => grid?.showGestureHelp()}
						aria-label="Show gesture help"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							width="18"
							height="18"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
						>
							<circle cx="12" cy="12" r="10"></circle>
							<path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path>
							<line x1="12" y1="17" x2="12.01" y2="17"></line>
						</svg>
					</button>
				{/if}
			</div>
		</header>

		<div class="desktop-layout">
			<svelte:boundary>
				<div class="main-content">
					{#if !desktop.current}
						<!-- Block wrapper: .main-content is a flex column on mobile, where the
						     sidebar's stacked mb-4 margins would stop collapsing. -->
						<div>
							<PartySidebar />
						</div>
					{/if}

					<div class="grid-slot mb-4 lg:mb-0">
						<SimpleGrid bind:this={grid} />
					</div>
				</div>
				{#snippet failed(_error, reset)}
					<BoundaryFallback {reset} />
				{/snippet}
			</svelte:boundary>

			{#if desktop.current}
				<aside class="sidebar">
					<svelte:boundary>
						<PartySidebar />
						{#snippet failed(_error, reset)}
							<BoundaryFallback {reset} />
						{/snippet}
					</svelte:boundary>
				</aside>
			{/if}
		</div>
	{/if}
</div>

<style>
	.header-actions {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.help-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 36px;
		height: 36px;
		color: var(--text-secondary);
		background: var(--bg-secondary);
		border: 1px solid var(--border-color);
		border-radius: 999px;
		cursor: pointer;
		transition: all 150ms ease;
	}

	.help-btn:hover {
		background: rgba(255, 255, 255, 0.08);
		color: var(--text-primary);
	}

	.help-btn:focus-visible {
		outline: 2px solid rgb(var(--rgb-teal) / 0.9);
		outline-offset: 2px;
	}

	/* Mobile-first: viewport-fitting layout */
	.party-page {
		min-height: 100vh;
		min-height: 100dvh; /* Dynamic viewport height for mobile browsers */
		display: flex;
		flex-direction: column;
		padding: 1rem;
		padding-bottom: calc(1rem + env(safe-area-inset-bottom, 0px));
		overflow-x: hidden;
	}

	/* On mobile, lock to viewport and prevent vertical scroll when possible */
	@media (max-width: 1023px) {
		.party-page {
			height: 100vh;
			height: 100dvh;
			overflow-y: auto;
			-webkit-overflow-scrolling: touch;
		}

		.main-content {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-height: 0; /* Allow flex shrinking */
		}

		.main-content > .grid-slot {
			flex: 1;
			display: flex;
			flex-direction: column;
			min-height: 0;
		}
	}

	@media (min-width: 1024px) {
		.party-page {
			padding-bottom: 1rem;
		}

		.desktop-layout {
			display: flex;
			gap: 1.5rem;
			align-items: flex-start;
		}

		.main-content {
			flex: 1;
			min-width: 0;
		}

		.sidebar {
			width: 340px;
			max-width: 400px;
			flex-shrink: 0;
		}
	}

	@media (min-width: 1280px) {
		.sidebar {
			width: 380px;
		}
	}
</style>
