/* eslint-disable no-console -- the one sanctioned console sink for src/lib diagnostics */

/** Non-fatal diagnostic, visible in devtools. */
export function logWarn(...args: unknown[]): void {
	console.warn(...args);
}

/** Fatal-path diagnostic; stays at console.error severity so Sentry records it as an error. */
export function logError(...args: unknown[]): void {
	console.error(...args);
}
