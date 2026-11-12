import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
	use: {
		baseURL: 'http://localhost:4173',
		serviceWorkers: 'block',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	expect: {
		// Visual regression tolerance — small enough to catch real CSS regressions,
		// large enough to absorb font-rendering differences between local macOS and
		// CI Linux Chromium. Bump if false positives become a problem.
		toHaveScreenshot: {
			maxDiffPixels: 100,
			animations: 'disabled',
		},
	},
	projects: [
		{
			name: 'chromium',
			use: { ...devices['Desktop Chrome'] },
		},
		{
			name: 'Mobile Chrome',
			use: { ...devices['Pixel 5'] },
		},
	],
	webServer: {
		command: 'npm run build && npm run preview',
		url: 'http://localhost:4173',
		reuseExistingServer: !process.env.CI,
		timeout: 120000,
		// Every e2e test mocks Supabase in the browser, and the party page's server load
		// degrades when Supabase is unreachable. Point the build at an unused port so a
		// local run never reaches the database in .env (production). A deliberate run
		// against a real backend sets E2E_SUPABASE_URL / E2E_SUPABASE_ANON_KEY.
		env: {
			VITE_SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:59999',
			VITE_SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? 'e2e-unused',
			SUPABASE_URL: process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:59999',
			SUPABASE_ANON_KEY: process.env.E2E_SUPABASE_ANON_KEY ?? 'e2e-unused',
		},
	},
});
