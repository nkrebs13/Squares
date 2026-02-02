import { describe, it, expect } from 'vitest';
import { formatPrice, isValidUsdAmount, parseUsdAmount } from '$lib/utils/format';

describe('formatPrice', () => {
	it('returns no decimals for integer amounts', () => {
		expect(formatPrice(10)).toBe('$10');
	});

	it('returns cents for decimal amounts', () => {
		expect(formatPrice(10.5)).toBe('$10.50');
	});

	it('includes commas for large numbers', () => {
		expect(formatPrice(1500)).toBe('$1,500');
	});

	it('formats zero', () => {
		expect(formatPrice(0)).toBe('$0');
	});

	it('formats large decimal amounts', () => {
		expect(formatPrice(1500.75)).toBe('$1,500.75');
	});
});

describe('isValidUsdAmount', () => {
	it('accepts valid integer strings', () => {
		expect(isValidUsdAmount('10')).toBe(true);
	});

	it('accepts valid decimal strings', () => {
		expect(isValidUsdAmount('10.50')).toBe(true);
	});

	it('accepts single decimal place', () => {
		expect(isValidUsdAmount('10.5')).toBe(true);
	});

	it('rejects empty string', () => {
		expect(isValidUsdAmount('')).toBe(false);
	});

	it('rejects letters', () => {
		expect(isValidUsdAmount('abc')).toBe(false);
	});

	it('rejects too many decimal places', () => {
		expect(isValidUsdAmount('10.123')).toBe(false);
	});

	it('accepts zero', () => {
		expect(isValidUsdAmount('0')).toBe(true);
	});

	it('rejects whitespace-only string', () => {
		expect(isValidUsdAmount('   ')).toBe(false);
	});
});

describe('parseUsdAmount', () => {
	it('parses a valid integer string', () => {
		expect(parseUsdAmount('10')).toBe(10);
	});

	it('parses a valid decimal string', () => {
		expect(parseUsdAmount('10.50')).toBe(10.5);
	});

	it('returns null for invalid input', () => {
		expect(parseUsdAmount('abc')).toBeNull();
	});

	it('returns null for too many decimals', () => {
		expect(parseUsdAmount('10.555')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseUsdAmount('')).toBeNull();
	});
});
