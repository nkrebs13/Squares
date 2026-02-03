<script lang="ts">
	import { page } from '$app/stores';
</script>

<div class="error-page">
	<div class="error-card">
		<div class="error-icon">!</div>
		<h1>Something went wrong</h1>
		<p class="error-message">
			{$page.error?.message || 'An unexpected error occurred.'}
		</p>
		<div class="error-actions">
			<button class="btn btn-primary" onclick={() => window.location.reload()}>
				Reload Page
			</button>
			<a href="/" class="btn btn-secondary">Go Home</a>
		</div>
	</div>
</div>

<style>
	.error-page {
		min-height: 100vh;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 1rem;
	}

	.error-card {
		text-align: center;
		max-width: 28rem;
		width: 100%;
	}

	.error-icon {
		width: 3.5rem;
		height: 3.5rem;
		border-radius: 50%;
		background: rgba(239, 68, 68, 0.15);
		color: #f87171;
		font-size: 1.5rem;
		font-weight: bold;
		display: flex;
		align-items: center;
		justify-content: center;
		margin: 0 auto 1.5rem;
		border: 1px solid rgba(239, 68, 68, 0.3);
	}

	h1 {
		font-size: 1.5rem;
		font-weight: 600;
		margin-bottom: 0.75rem;
		color: var(--text-primary);
	}

	.error-message {
		color: var(--text-secondary);
		margin-bottom: 2rem;
		font-size: 0.9375rem;
		line-height: 1.5;
	}

	.error-actions {
		display: flex;
		gap: 0.75rem;
		justify-content: center;
	}
</style>
