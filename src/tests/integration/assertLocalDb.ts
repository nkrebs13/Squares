// `URL#hostname` returns IPv6 addresses bracketed (e.g. "[::1]"), so both
// forms are listed defensively even though the bracketed form is what
// actually comes back from the parser.
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/**
 * Guard against local-only tooling — the integration test suite (and its
 * service-role cleanup pass) and the portfolio screenshot capture script —
 * running against a non-local Supabase project.
 *
 * `helpers.ts` builds an anon client AND a service-role client from this
 * same URL. The service-role client's `cleanupAllTestParties()` deletes any
 * party with `host_pin = '1234'` older than an hour — a real, plausible PIN.
 * `scripts/capture-screenshots.ts` creates a party, claims squares, locks
 * the game, and deletes the party via the same RPCs a real host would use.
 * Both callers resolve their Supabase URL from `VITE_SUPABASE_URL`/`.env`
 * by default, which points at production — if the resolved URL ever points
 * at a production Supabase project, either caller mutates or destroys real
 * users' data.
 *
 * Hostname comparison only — never `String.includes`/`endsWith`, which a
 * crafted host like `localhost.evil.com` or `127.0.0.1.example.com` would
 * defeat by embedding the trusted string as a substring rather than being it.
 */
export function assertLocalSupabaseUrl(url: string, allowRemote: boolean): void {
	if (allowRemote) return;

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(
			`Refusing to run: "${url}" is not a valid URL and cannot be verified as a local ` +
				`Supabase instance. Run 'supabase start' and point at its local URL (defaults to ` +
				`http://127.0.0.1:54321, or see 'supabase status -o env'). ` +
				`To intentionally run against a remote database, set ALLOW_REMOTE_INTEGRATION_DB=1.`
		);
	}

	if (!LOCAL_HOSTNAMES.has(parsed.hostname)) {
		throw new Error(
			`Refusing to run against non-local host "${parsed.hostname}" (resolved from "${url}"). ` +
				`This process creates AND DELETES real rows via a service-role or admin client — ` +
				`running it against anything but a local Supabase instance can destroy production ` +
				`data. Run 'supabase start', then point this process at the local URL/keys from ` +
				`'supabase status -o env' instead of the VITE_* values your .env sets for the app ` +
				`itself. See CONTRIBUTING.md. ` +
				`To intentionally opt out and run against a remote database, set ` +
				`ALLOW_REMOTE_INTEGRATION_DB=1.`
		);
	}
}
