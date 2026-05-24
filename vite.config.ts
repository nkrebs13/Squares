import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig(({ mode }) => {
	// Read brand env vars at build time. vite.config runs in Node before
	// SvelteKit's $env replacement, so we use Vite's loadEnv helper which
	// reads .env / .env.local / .env.{mode} the same way runtime $env/dynamic/public
	// does. Without this, .env values would only reach the runtime config and the
	// PWA manifest would silently disagree. Defaults match src/lib/config.ts.
	const env = loadEnv(mode, process.cwd(), 'PUBLIC_');
	const APP_NAME = env.PUBLIC_APP_NAME || 'Football Squares';
	const APP_DESCRIPTION =
		env.PUBLIC_APP_DESCRIPTION || 'Run Football Squares pools at your Super Bowl party';

	return {
		test: {
			environment: 'jsdom',
			setupFiles: ['./src/tests/setup.ts'],
			include: ['src/**/*.{test,spec}.{js,ts}'],
			exclude: ['src/tests/integration/**'],
			globals: true,
			testTimeout: 15000,
			coverage: {
				provider: 'v8',
				reporter: ['text', 'json', 'html', 'json-summary'],
				include: ['src/lib/**/*.{ts,svelte}'],
				exclude: [
					'src/lib/supabase.ts',
					'src/lib/index.ts', // barrel re-export
					'src/lib/stores/game.ts', // barrel re-export
					'src/lib/push.ts', // browser Push API — requires real ServiceWorker
				],
				thresholds: {
					lines: 93,
					functions: 93,
					branches: 81,
					statements: 92,
				},
			},
		},
		plugins: [
			tailwindcss(),
			sveltekit(),
			svelteTesting(),
			SvelteKitPWA({
				srcDir: 'src',
				strategies: 'generateSW',
				registerType: 'autoUpdate',
				manifest: {
					name: APP_NAME,
					short_name: 'Squares',
					description: APP_DESCRIPTION,
					theme_color: '#1a2744',
					background_color: '#1a2744',
					display: 'standalone',
					orientation: 'portrait',
					start_url: '/',
					icons: [
						{
							src: '/icons/icon.svg',
							sizes: 'any',
							type: 'image/svg+xml',
							purpose: 'any',
						},
						{
							src: '/icons/icon-192.png',
							sizes: '192x192',
							type: 'image/png',
							purpose: 'any',
						},
						{
							src: '/icons/icon-512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'any',
						},
						{
							src: '/icons/icon-512.png',
							sizes: '512x512',
							type: 'image/png',
							purpose: 'maskable',
						},
					],
				},
				workbox: {
					importScripts: ['/push-sw.js'],
					navigateFallback: undefined,
					globPatterns: [
						'client/**/*.{js,css,ico,png,svg,webp,webmanifest}',
						'client/*.webmanifest',
					],
					modifyURLPrefix: {
						'client/': '',
					},
					runtimeCaching: [
						{
							urlPattern: /^https:\/\/.*\.supabase\.co\/rest\/v1\/rpc\/.*/i,
							handler: 'NetworkOnly', // RPCs must always hit server
						},
						{
							urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
							handler: 'NetworkFirst',
							options: {
								cacheName: 'supabase-cache',
								expiration: {
									maxEntries: 50,
									maxAgeSeconds: 60,
								},
							},
						},
					],
				},
				devOptions: {
					enabled: false,
				},
			}),
		],
	};
});
