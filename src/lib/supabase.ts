// Supabase client configuration
import { createClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';

// `Database` from src/lib/database.types.ts documents the RPC surface (Functions
// only — Tables are typed loosely there). Wiring it through `createClient<Database>`
// is intentionally deferred until `npm run db:types` can be run against a live
// local Supabase instance to produce the full Tables shape. Today the type lives
// alongside this file as a reviewable contract; real type-safe RPCs land when
// the Tables surface is generated. See database.types.ts top comment for the
// full plan and the script.

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (browser) {
	if (!supabaseUrl || typeof supabaseUrl !== 'string') {
		throw new Error('Missing VITE_SUPABASE_URL environment variable');
	}
	if (!supabaseAnonKey || typeof supabaseAnonKey !== 'string') {
		throw new Error('Missing VITE_SUPABASE_ANON_KEY environment variable');
	}
}

export const supabase = browser
	? createClient(supabaseUrl, supabaseAnonKey, {
			realtime: {
				params: {
					eventsPerSecond: 10,
				},
			},
		})
	: null;

export function getSupabaseClient() {
	if (!supabase) {
		throw new Error('Supabase client not available on server');
	}
	return supabase;
}
