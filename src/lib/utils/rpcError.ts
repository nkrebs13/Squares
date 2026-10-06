/**
 * One `[pattern, copy]` mapping: when the normalized Postgres message matches
 * `pattern`, the user sees `copy` instead.
 */
export type RpcErrorRule = readonly [pattern: RegExp, copy: string];

/**
 * Party-field validation copy shared by create_party and update_party_details
 * (both RAISE the same messages for these fields, and both show the same copy).
 */
export const PARTY_FIELD_RULES: readonly RpcErrorRule[] = [
	[/event_name/i, 'Event name must be 80 characters or fewer.'],
	[/different teams/i, 'Choose two different teams for the matchup.'],
	[/colors/i, 'Team colors must be valid hex colors.'],
];

/**
 * Transport failures. supabase-js turns a rejected fetch into
 * `error.message = "${name}: ${message}"` (e.g. "TypeError: Failed to fetch",
 * "TypeError: Load failed" on Safari, "AbortError: ..."). PostgREST/Postgres
 * messages never start with these prefixes, so these always get the fallback.
 */
const NETWORK_ERROR =
	/^(?:TypeError|FetchError|AbortError)\b|failed to fetch|networkerror when attempting|load failed|fetch failed|network request failed/i;

/**
 * Translate a raw Postgres/PostgREST error message into user-facing copy.
 *
 * Strips the `ERROR:  ` prefix. Network failures and empty messages get
 * `fallback`; otherwise the copy of the first matching rule, otherwise the
 * trimmed message itself (the RPCs `RAISE EXCEPTION` with readable text).
 */
export function humanizeRpcError(
	raw: string,
	fallback: string,
	rules: readonly RpcErrorRule[] = []
): string {
	const normalized = raw.replace(/^ERROR:\s*/i, '').trim();
	if (NETWORK_ERROR.test(normalized)) return fallback;
	for (const [pattern, copy] of rules) {
		if (pattern.test(normalized)) return copy;
	}
	return normalized || fallback;
}
