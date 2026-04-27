/**
 * Client-side SvelteKit hooks: Sentry + Web Vitals.
 *
 * Sentry init is a no-op when `PUBLIC_SENTRY_DSN` is unset, so a fork of
 * this repo without a Sentry account works identically.
 */

import * as Sentry from '@sentry/sveltekit';
import { handleErrorWithSentry } from '@sentry/sveltekit';
import { onCLS, onINP, onLCP, onFCP, onTTFB } from 'web-vitals';
import { env } from '$env/dynamic/public';

const dsn = env.PUBLIC_SENTRY_DSN;
const SENTRY_ENABLED = Boolean(dsn);

if (SENTRY_ENABLED) {
	Sentry.init({
		dsn,
		// Performance traces sampled at 10% to keep free-tier usage in budget for
		// portfolio-traffic patterns. Bump to 1.0 in dev or for incident triage.
		tracesSampleRate: 0.1,
		// PII is unnecessary — squares pool players are a closed set of friends
		// and we don't want IPs ending up in Sentry.
		sendDefaultPii: false,
	});

	// Web Vitals → Sentry custom measurements.
	// Only ship if Sentry is configured; otherwise the metrics have nowhere to go.
	const reportMetric = (metric: { name: string; value: number; rating: string }) => {
		Sentry.setMeasurement(metric.name, metric.value, metric.name === 'CLS' ? '' : 'millisecond');
		Sentry.addBreadcrumb({
			category: 'web-vitals',
			level: metric.rating === 'good' ? 'info' : 'warning',
			message: `${metric.name} ${metric.value.toFixed(2)} (${metric.rating})`,
			data: { name: metric.name, value: metric.value, rating: metric.rating },
		});
	};

	onCLS(reportMetric);
	onINP(reportMetric);
	onLCP(reportMetric);
	onFCP(reportMetric);
	onTTFB(reportMetric);
}

// SvelteKit hook for unhandled client errors. handleErrorWithSentry is a
// no-op when Sentry isn't initialized, so wiring this unconditionally is safe.
export const handleError = handleErrorWithSentry();
