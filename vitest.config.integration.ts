import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'node',
		include: ['src/tests/integration/**/*.{test,spec}.{js,ts}'],
		globals: true,
		fileParallelism: false,
		globalSetup: ['src/tests/integration/globalSetup.ts'],
		testTimeout: 30000,
		hookTimeout: 30000,
		env: {
			// CI sets VITE_SUPABASE_* via $GITHUB_ENV; TEST_SUPABASE_* for local override
			VITE_SUPABASE_URL:
				process.env.TEST_SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://127.0.0.1:54321',
			VITE_SUPABASE_ANON_KEY:
				process.env.TEST_SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || 'not-set',
		},
	},
});
