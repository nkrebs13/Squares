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

	it.each([
		'TypeError: Failed to fetch',
		'TypeError: NetworkError when attempting to fetch resource.',
		'TypeError: Load failed',
		'TypeError: fetch failed',
		'FetchError: request to https://x failed',
		'AbortError: The operation was aborted.',
		'Network request failed',
	])('maps network failure %j to the fallback, ahead of any rule', (raw) => {
		expect(humanizeRpcError(raw, 'fallback', [[/fetch|load|abort|network/i, 'rule']])).toBe(
			'fallback'
		);
	});

	it('does not treat ordinary Postgres messages as network failures', () => {
		expect(humanizeRpcError('ERROR: type error in column', 'fallback')).toBe(
			'type error in column'
		);
	});
});
