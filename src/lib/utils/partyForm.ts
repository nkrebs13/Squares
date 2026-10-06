import { datetimeLocalToIso, formatKickoff } from '$lib/utils/datetime';
import { areDistinctTeamNames } from '$lib/utils/teamNames';

export const MAX_EVENT_NAME_LENGTH = 80;

/** A host PIN is exactly four digits. */
export function isValidPin(pin: string): boolean {
	return pin.length === 4 && /^\d+$/.test(pin);
}

export function isValidHostName(name: string): boolean {
	return name.trim().length > 0;
}

export function isValidEventName(name: string): boolean {
	const trimmed = name.trim();
	return trimmed.length > 0 && trimmed.length <= MAX_EVENT_NAME_LENGTH;
}

/** Both team names are present (after trimming) and name two different teams. */
export function isValidMatchup(rowName: string, colName: string): boolean {
	return (
		rowName.trim().length > 0 && colName.trim().length > 0 && areDistinctTeamNames(rowName, colName)
	);
}

/** Human-readable kickoff line for a `datetime-local` input value (null when unset or invalid). */
export function formatKickoffPreview(kickoffInput: string): string | null {
	return formatKickoff(datetimeLocalToIso(kickoffInput), {
		includeWeekday: true,
		includeTimeZone: true,
	});
}
