/**
 * Format a price as USD currency.
 * Round numbers (no decimal) display without cents (e.g., $1, $10).
 * Non-round numbers display with cents (e.g., $1.50, $10.25).
 */
export function formatPrice(amount: number): string {
	if (Number.isInteger(amount)) {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'USD',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(amount);
	}
	return new Intl.NumberFormat('en-US', {
		style: 'currency',
		currency: 'USD',
		minimumFractionDigits: 2,
		maximumFractionDigits: 2
	}).format(amount);
}

/**
 * Validate that a string represents a valid USD amount.
 * Allows positive numbers with up to 2 decimal places.
 */
export function isValidUsdAmount(value: string): boolean {
	if (!value || value.trim() === '') return false;
	// Allow numbers with optional decimal and up to 2 decimal places
	const usdPattern = /^\d+(\.\d{0,2})?$/;
	return usdPattern.test(value.trim()) && parseFloat(value) >= 0;
}

/**
 * Parse a string to a valid USD number.
 * Returns null if invalid.
 */
export function parseUsdAmount(value: string): number | null {
	if (!isValidUsdAmount(value)) return null;
	const parsed = parseFloat(value);
	// Round to 2 decimal places to avoid floating point issues
	return Math.round(parsed * 100) / 100;
}
