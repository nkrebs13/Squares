/**
 * Server-side SvelteKit hooks: Sentry init for the resolved SvelteKit adapter.
 * No-op when PUBLIC_SENTRY_DSN is unset.
 */

import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

if (env.PUBLIC_SENTRY_DSN) {
	Sentry.init({
		dsn: env.PUBLIC_SENTRY_DSN,
		tracesSampleRate: 0.1,
		sendDefaultPii: false,
	});
}

export const handleError = handleErrorWithSentry();
