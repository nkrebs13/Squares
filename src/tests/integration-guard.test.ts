import { describe, it, expect } from 'vitest';
import { assertLocalSupabaseUrl } from './integration/assertLocalDb';

describe('assertLocalSupabaseUrl', () => {
	it('allows 127.0.0.1 with a port', () => {
		expect(() => assertLocalSupabaseUrl('http://127.0.0.1:54321', false)).not.toThrow();
	});

	it('allows localhost with a port', () => {
		expect(() => assertLocalSupabaseUrl('http://localhost:54321', false)).not.toThrow();
	});

	it('allows the IPv6 loopback address', () => {
		expect(() => assertLocalSupabaseUrl('http://[::1]:54321', false)).not.toThrow();
	});

	it('allows 0.0.0.0', () => {
		expect(() => assertLocalSupabaseUrl('http://0.0.0.0:54321', false)).not.toThrow();
	});

	it('throws for a production-shaped Supabase host', () => {
		expect(() => assertLocalSupabaseUrl('https://abcd1234.supabase.co', false)).toThrow(
			/non-local host/
		);
	});

	it('throws for a lookalike host that merely contains "localhost" as a subdomain label', () => {
		expect(() => assertLocalSupabaseUrl('https://localhost.evil.com', false)).toThrow(
			/non-local host/
		);
	});

	it('throws for a lookalike host that embeds "127.0.0.1" as a prefix of a real domain', () => {
		expect(() => assertLocalSupabaseUrl('https://127.0.0.1.example.com', false)).toThrow(
			/non-local host/
		);
	});

	it('permits a remote host when allowRemote is true', () => {
		expect(() => assertLocalSupabaseUrl('https://abcd1234.supabase.co', true)).not.toThrow();
	});

	it('throws for unparseable input (fail closed)', () => {
		expect(() => assertLocalSupabaseUrl('not-a-url', false)).toThrow(/not a valid URL/);
	});

	it('mentions the ALLOW_REMOTE_INTEGRATION_DB opt-out in the error message', () => {
		expect(() => assertLocalSupabaseUrl('https://abcd1234.supabase.co', false)).toThrow(
			/ALLOW_REMOTE_INTEGRATION_DB/
		);
	});
});
