import { env } from '$env/dynamic/private';

/**
 * The Supabase project a server route talks to: the server's own settings
 * (SUPABASE_URL / SUPABASE_ANON_KEY) first, else the ones the client bundle was
 * built with. Null when either is missing.
 */
export function serverSupabaseEnv(): { url: string; anonKey: string } | null {
	const url = env.SUPABASE_URL ?? env.VITE_SUPABASE_URL;
	const anonKey = env.SUPABASE_ANON_KEY ?? env.VITE_SUPABASE_ANON_KEY;
	return url && anonKey ? { url, anonKey } : null;
}
