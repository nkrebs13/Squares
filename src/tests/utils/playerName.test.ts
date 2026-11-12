import { describe, it, expect } from 'vitest';
import { normalizePlayerName } from '$lib/utils/playerName';

describe('normalizePlayerName', () => {
	it('lowercases the name', () => {
		expect(normalizePlayerName('John Doe')).toBe('john doe');
	});

	it('trims whitespace', () => {
		expect(normalizePlayerName('  Alice  ')).toBe('alice');
	});
});
