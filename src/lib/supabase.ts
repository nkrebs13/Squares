// Supabase client configuration
import { createClient } from '@supabase/supabase-js';
import { browser } from '$app/environment';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export const supabase = browser
	? createClient(supabaseUrl, supabaseAnonKey, {
			realtime: {
				params: {
					eventsPerSecond: 10
				}
			}
		})
	: null;

export function getSupabaseClient() {
	if (!supabase) {
		throw new Error('Supabase client not available on server');
	}
	return supabase;
}
