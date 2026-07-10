// `URL#hostname` returns IPv6 addresses bracketed (e.g. "[::1]"), so both
// forms are listed defensively even though the bracketed form is what
// actually comes back from the parser.
const LOCAL_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '::1', '[::1]', '0.0.0.0']);

/**
 * Guard against integration tests (and their service-role cleanup pass)
 * running against a non-local Supabase project.
 *
 * `helpers.ts` builds an anon client AND a service-role client from this
 * same URL. The service-role client's `cleanupAllTestParties()` deletes any
 * party with `host_pin = '1234'` older than an hour — a real, plausible PIN.
 * If the resolved URL ever points at a production Supabase project (e.g.
 * because `.env` sets `VITE_SUPABASE_URL` and a worker/env override didn't
 * apply), that cleanup pass deletes real users' data.
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
			`Integration tests refuse to run: "${url}" is not a valid URL and cannot be ` +
				`verified as a local Supabase instance. ` +
				`Run 'supabase start' and let it default to http://127.0.0.1:54321, or set ` +
				`TEST_SUPABASE_URL to a valid local URL. ` +
				`To intentionally run against a remote database, set ALLOW_REMOTE_INTEGRATION_DB=1.`
		);
	}

	if (!LOCAL_HOSTNAMES.has(parsed.hostname)) {
		throw new Error(
			`Integration tests refuse to run against non-local host "${parsed.hostname}" ` +
				`(resolved from "${url}"). This test suite creates AND DELETES real rows via a ` +
				`service-role client — running it against anything but a local Supabase instance ` +
				`can destroy production data. ` +
				`Run 'supabase start', then export TEST_SUPABASE_URL and TEST_SUPABASE_KEY from ` +
				`'supabase status -o env' (they take precedence over the VITE_* values your .env ` +
				`sets for the app itself). See CONTRIBUTING.md. ` +
				`To intentionally opt out and run against a remote database, set ` +
				`ALLOW_REMOTE_INTEGRATION_DB=1.`
		);
	}
}
