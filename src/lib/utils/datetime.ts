/**
 * Convert an ISO timestamp into the local value shape expected by
 * <input type="datetime-local">: YYYY-MM-DDTHH:mm.
 */
export function toDatetimeLocalValue(value: string | null | undefined): string {
	if (!value) return '';

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return '';

	const offsetMs = date.getTimezoneOffset() * 60_000;
	return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** Convert a datetime-local value into an ISO timestamp for Supabase. */
export function datetimeLocalToIso(value: string): string | null {
	if (!value) return null;

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;

	return date.toISOString();
}

export function getLocalTimeZoneLabel(): string {
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (!timeZone) return 'local time';

	const shortName = new Intl.DateTimeFormat(undefined, { timeZoneName: 'short' })
		.formatToParts(new Date())
		.find((part) => part.type === 'timeZoneName')?.value;

	return shortName
		? `${timeZone.replaceAll('_', ' ')} (${shortName})`
		: timeZone.replaceAll('_', ' ');
}

export function formatKickoff(
	value: string | null | undefined,
	options: { includeWeekday?: boolean; includeTimeZone?: boolean } = {}
): string | null {
	if (!value) return null;

	const date = new Date(value);
	if (Number.isNaN(date.getTime())) return null;

	return new Intl.DateTimeFormat(undefined, {
		weekday: options.includeWeekday ? 'short' : undefined,
		month: 'short',
		day: 'numeric',
		hour: 'numeric',
		minute: '2-digit',
		timeZoneName: options.includeTimeZone ? 'short' : undefined,
	}).format(date);
}
