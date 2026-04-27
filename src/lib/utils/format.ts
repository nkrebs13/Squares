import { APP_CONFIG } from '$lib/config';

/**
 * Format a price in the configured currency + locale.
 * Round numbers (no decimal) display without cents (e.g., $1, $10).
 * Non-round numbers display with cents (e.g., $1.50, $10.25).
 *
 * Reads APP_CONFIG.currency.{code,locale} — override via PUBLIC_CURRENCY_CODE
 * and PUBLIC_LOCALE. On invalid currency codes, falls back to a generic
 * "amount code" format rather than throwing.
 */
export function formatPrice(amount: number): string {
	const { code, locale } = APP_CONFIG.currency;
	const fractionDigits = Number.isInteger(amount) ? 0 : 2;
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency: code,
			minimumFractionDigits: fractionDigits,
			maximumFractionDigits: fractionDigits,
		}).format(amount);
	} catch {
		return `${amount.toFixed(fractionDigits)} ${code}`;
	}
}

/**
 * Validate that a string represents a valid currency amount.
 * Allows positive numbers with up to 2 decimal places.
 */
export function isValidAmount(value: string): boolean {
	if (!value || value.trim() === '') return false;
	const pattern = /^\d+(\.\d{0,2})?$/;
	return pattern.test(value.trim()) && parseFloat(value) >= 0;
}

/**
 * Parse a string to a valid amount.
 * Returns null if invalid.
 */
export function parseAmount(value: string): number | null {
	if (!isValidAmount(value)) return null;
	const parsed = parseFloat(value);
	return Math.round(parsed * 100) / 100;
}
