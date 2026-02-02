import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['src/tests/integration/**/*.{test,spec}.{js,ts}'],
		globals: true,
		testTimeout: 30000,
		hookTimeout: 30000,
		env: {
			VITE_SUPABASE_URL: process.env.TEST_SUPABASE_URL || 'http://127.0.0.1:54321',
			VITE_SUPABASE_ANON_KEY: process.env.TEST_SUPABASE_KEY || 'not-set',
		},
	},
});
