import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatPrice, isValidAmount, parseAmount } from '$lib/utils/format';

describe('formatPrice (default USD/en-US)', () => {
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

describe('formatPrice (config-driven currency override)', () => {
	beforeEach(() => {
		vi.resetModules();
	});

	it('honors PUBLIC_CURRENCY_CODE / PUBLIC_LOCALE overrides', async () => {
		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_CURRENCY_CODE: 'EUR', PUBLIC_LOCALE: 'de-DE' },
		}));
		const { formatPrice: localizedFormatPrice } = await import('$lib/utils/format');

		const formatted = localizedFormatPrice(10);
		expect(formatted).toContain('€');
		expect(formatted).toContain('10');
		expect(formatted).not.toContain('$');
	});

	it('falls back to plain "amount code" when given an unknown currency', async () => {
		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_CURRENCY_CODE: 'ZZZZ' },
		}));
		const { formatPrice: localizedFormatPrice } = await import('$lib/utils/format');

		expect(localizedFormatPrice(10)).toBe('10 ZZZZ');
	});

	it('preserves cents in the fallback path for non-integer amounts', async () => {
		vi.doMock('$env/dynamic/public', () => ({
			env: { PUBLIC_CURRENCY_CODE: 'ZZZZ' },
		}));
		const { formatPrice: localizedFormatPrice } = await import('$lib/utils/format');

		expect(localizedFormatPrice(10.5)).toBe('10.50 ZZZZ');
	});
});

describe('isValidAmount', () => {
	it('accepts valid integer strings', () => {
		expect(isValidAmount('10')).toBe(true);
	});

	it('accepts valid decimal strings', () => {
		expect(isValidAmount('10.50')).toBe(true);
	});

	it('accepts single decimal place', () => {
		expect(isValidAmount('10.5')).toBe(true);
	});

	it('rejects empty string', () => {
		expect(isValidAmount('')).toBe(false);
	});

	it('rejects letters', () => {
		expect(isValidAmount('abc')).toBe(false);
	});

	it('rejects too many decimal places', () => {
		expect(isValidAmount('10.123')).toBe(false);
	});

	it('rejects zero (price must be greater than 0)', () => {
		expect(isValidAmount('0')).toBe(false);
	});

	it('rejects whitespace-only string', () => {
		expect(isValidAmount('   ')).toBe(false);
	});
});

describe('parseAmount', () => {
	it('parses a valid integer string', () => {
		expect(parseAmount('10')).toBe(10);
	});

	it('parses a valid decimal string', () => {
		expect(parseAmount('10.50')).toBe(10.5);
	});

	it('returns null for invalid input', () => {
		expect(parseAmount('abc')).toBeNull();
	});

	it('returns null for too many decimals', () => {
		expect(parseAmount('10.555')).toBeNull();
	});

	it('returns null for empty string', () => {
		expect(parseAmount('')).toBeNull();
	});
});
