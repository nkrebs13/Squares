/**
 * Format quarter number to display label.
 * Q1-Q4 return "Q1" through "Q4"
 * Q5 (first overtime) returns "OT"
 * Q6+ return "2OT", "3OT", etc.
 */
export function formatQuarterLabel(quarter: number): string {
	if (quarter <= 4) {
		return `Q${quarter}`;
	}
	if (quarter === 5) {
		return 'OT';
	}
	return `${quarter - 4}OT`;
}
