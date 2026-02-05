/**
 * Format quarter number to display label.
 *
 * @param quarter - The quarter number (must be >= 1)
 * @returns Display label:
 *   - Quarter 1-4: "Q1" through "Q4"
 *   - Quarter 5 (first overtime): "OT"
 *   - Quarter 6+: "2OT", "3OT", etc.
 *   - Invalid input (< 1): empty string
 */
export function formatQuarterLabel(quarter: number): string {
	if (quarter < 1) {
		return '';
	}
	if (quarter <= 4) {
		return `Q${quarter}`;
	}
	if (quarter === 5) {
		return 'OT';
	}
	return `${quarter - 4}OT`;
}
