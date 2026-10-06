import { describe, it, expect } from 'vitest';
import { humanizeRpcError } from '$lib/utils/rpcError';

describe('humanizeRpcError', () => {
	it('strips the ERROR: prefix and passes the message through when no rule matches', () => {
		expect(humanizeRpcError('ERROR:  party not found', 'fallback')).toBe('party not found');
	});

	it('returns the fallback when nothing is left after normalizing', () => {
		expect(humanizeRpcError('', 'fallback')).toBe('fallback');
		expect(humanizeRpcError('ERROR:   ', 'fallback')).toBe('fallback');
	});

	it('returns the copy of the first matching rule, in order', () => {
		const rules = [
			[/team_.*name/i, 'first'],
			[/name/i, 'second'],
		] as const;
		expect(humanizeRpcError('team_row_name is blank', 'fallback', rules)).toBe('first');
		expect(humanizeRpcError('host name is blank', 'fallback', rules)).toBe('second');
	});

	it('matches rules against the normalized message, not the raw one', () => {
		expect(humanizeRpcError('ERROR: boom', 'fallback', [[/^boom$/, 'matched']])).toBe('matched');
	});
});
