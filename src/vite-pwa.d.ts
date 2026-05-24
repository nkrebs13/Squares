declare module 'virtual:pwa-info' {
	export interface PwaInfo {
		pwaInDevEnvironment: boolean;
		webManifest: {
			href: string;
			useCredentials: boolean;
			linkTag: string;
		};
		registerSW?: {
			inline: boolean;
			mode: 'inline' | 'script' | 'script-defer';
			inlinePath: string;
			registerPath: string;
			scope: string;
			type: 'classic' | 'module';
			scriptTag?: string;
		};
	}

	export const pwaInfo: PwaInfo | undefined;
}

declare module 'virtual:pwa-register' {
	import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

	export type { RegisterSWOptions };

	export function registerSW(options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void>;
}
