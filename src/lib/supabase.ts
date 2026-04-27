// Supabase client configuration
import { createClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';

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
