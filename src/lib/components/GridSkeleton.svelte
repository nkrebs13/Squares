<script lang="ts">
	// Skeleton loader for the grid while data is loading
	const rows = Array.from({ length: 10 }, (_, i) => i);
	const cols = Array.from({ length: 10 }, (_, i) => i);
</script>

<div class="grid-skeleton">
	<!-- Header skeleton -->
	<div class="skeleton-header">
		<div class="skeleton-badge"></div>
		<div class="skeleton-text"></div>
	</div>

	<!-- Grid skeleton -->
	<div class="skeleton-grid-container">
		<!-- Column numbers -->
		<div class="skeleton-col-numbers">
			<div class="skeleton-corner"></div>
			{#each cols as col}
				<div class="skeleton-number"></div>
			{/each}
		</div>

		<!-- Grid rows -->
		{#each rows as row}
			<div class="skeleton-row">
				<div class="skeleton-number"></div>
				{#each cols as col}
					<div class="skeleton-square" style="animation-delay: {(row * 10 + col) * 20}ms"></div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<style>
	.grid-skeleton {
		display: flex;
		flex-direction: column;
		gap: 1rem;
	}

	.skeleton-header {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0.75rem;
	}

	.skeleton-badge {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 50%;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.04) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
	}

	.skeleton-text {
		width: 6rem;
		height: 1.25rem;
		border-radius: 4px;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.04) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
	}

	.skeleton-grid-container {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.skeleton-col-numbers {
		display: flex;
		gap: 2px;
	}

	.skeleton-corner {
		width: 1.75rem;
		height: 1.75rem;
		flex-shrink: 0;
	}

	.skeleton-number {
		width: 2.75rem;
		height: 1.75rem;
		border-radius: 4px;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.04) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.04) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		flex-shrink: 0;
	}

	.skeleton-row {
		display: flex;
		gap: 2px;
	}

	.skeleton-row .skeleton-number {
		width: 1.75rem;
		height: 2.75rem;
	}

	.skeleton-square {
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 6px;
		background: linear-gradient(90deg, rgba(255, 255, 255, 0.03) 0%, rgba(255, 255, 255, 0.06) 50%, rgba(255, 255, 255, 0.03) 100%);
		background-size: 200% 100%;
		animation: shimmer 1.5s infinite;
		flex-shrink: 0;
	}

	@media (min-width: 768px) {
		.skeleton-number {
			width: 3rem;
			height: 2rem;
		}

		.skeleton-row .skeleton-number {
			width: 2rem;
			height: 3rem;
		}

		.skeleton-square {
			width: 3rem;
			height: 3rem;
		}
	}

	@keyframes shimmer {
		0% {
			background-position: -200% 0;
		}
		100% {
			background-position: 200% 0;
		}
	}
</style>
