import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import pkg from '../../../package.json';
import { APP_CONFIG } from '$lib/config';

export function GET() {
	return json({
		ok: true,
		app: APP_CONFIG.appName,
		version: pkg.version,
		supabaseConfigured: Boolean(env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY),
	});
}
