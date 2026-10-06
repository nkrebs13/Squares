/* eslint-disable no-console -- the sanctioned console sink for app diagnostics */

// Every console call in src/lib, src/routes and the hooks goes through here, except
// one: validators/realtime.ts warn() calls console.warn directly behind a
// `typeof console` guard, so the validators stay usable where no console exists.

/** Non-fatal diagnostic, visible in devtools. */
export function logWarn(...args: unknown[]): void {
	console.warn(...args);
}

/** Error-severity diagnostic (console.error, so Sentry records it as an error). */
export function logError(...args: unknown[]): void {
	console.error(...args);
}
