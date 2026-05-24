import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	testDir: './e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 2 : 0,
	workers: process.env.CI ? 1 : undefined,
	reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'html',
	use: {
		baseURL: 'http://localhost:4173',
		serviceWorkers: 'block',
		trace: 'on-first-retry',
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
	},
});
