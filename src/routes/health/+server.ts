import { json } from '@sveltejs/kit';
import { serverSupabaseEnv } from '$lib/server/supabaseEnv';
import pkg from '../../../package.json';
import { APP_CONFIG } from '$lib/config';

export function GET() {
	return json({
		ok: true,
		app: APP_CONFIG.appName,
		version: pkg.version,
		supabaseConfigured: serverSupabaseEnv() !== null,
	});
}
