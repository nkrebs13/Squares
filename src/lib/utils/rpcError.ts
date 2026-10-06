/**
 * One `[pattern, copy]` mapping: when the normalized Postgres message matches
 * `pattern`, the user sees `copy` instead.
 */
export type RpcErrorRule = readonly [pattern: RegExp, copy: string];

/**
 * Translate a raw Postgres/PostgREST error message into user-facing copy.
 *
 * Strips the `ERROR:  ` prefix, returns the copy of the first matching rule,
 * otherwise the trimmed message itself (the RPCs `RAISE EXCEPTION` with
 * readable text), and `fallback` only when nothing is left.
 */
export function humanizeRpcError(
	raw: string,
	fallback: string,
	rules: readonly RpcErrorRule[] = []
): string {
	const normalized = raw.replace(/^ERROR:\s*/i, '').trim();
	for (const [pattern, copy] of rules) {
		if (pattern.test(normalized)) return copy;
	}
	return normalized || fallback;
}
