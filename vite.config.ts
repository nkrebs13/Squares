import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

export default defineConfig({
	plugins: [
		tailwindcss(),
		sveltekit(),
		SvelteKitPWA({
			srcDir: 'src',
			strategies: 'generateSW',
			registerType: 'autoUpdate',
			manifest: {
				name: 'Football Squares',
				short_name: 'Squares',
				description: 'Run Football Squares pools at your Super Bowl party',
				theme_color: '#1a1a2e',
				background_color: '#1a1a2e',
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
						src: '/icons/icon.svg',
						sizes: 'any',
						type: 'image/svg+xml',
						purpose: 'maskable',
					},
				],
			},
			workbox: {
				globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
				runtimeCaching: [
					{
						urlPattern: /^https:\/\/.*\.supabase\.co\/.*/i,
						handler: 'NetworkFirst',
						options: {
							cacheName: 'supabase-cache',
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 60 * 5, // 5 minutes
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
