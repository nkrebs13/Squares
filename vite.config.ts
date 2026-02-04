import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';
import { svelteTesting } from '@testing-library/svelte/vite';

export default defineConfig({
	test: {
		environment: 'jsdom',
		setupFiles: ['./src/tests/setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/tests/integration/**'],
		globals: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'json-summary'],
			include: ['src/lib/**/*.{ts,svelte}'],
			exclude: ['src/lib/supabase.ts'],
			thresholds: {
				lines: 89,
				functions: 88,
				branches: 80,
				statements: 89,
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
				name: 'Football Squares',
				short_name: 'Squares',
				description: 'Run Football Squares pools at your Super Bowl party',
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
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
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
});
