// What a host action's refusal says to the user. Pure (no client), so the server's
// refusal codes and fields can be checked against it directly.

import {
	DB_MAX_TEAM_NAME_LENGTH,
	MAX_EVENT_NAME_LENGTH,
	MIN_SQUARE_PRICE,
	PIN_LENGTH,
	SQUARE_PRICE_CEILING,
} from '$lib/constants';
/** Refusal codes every `host_*` RPC returns (migrations 035, 036). */
export type HostRefusal =
	'not_found' | 'invalid_pin' | 'locked_out' | 'wrong_status' | 'grid_incomplete' | 'invalid_input';

const REFUSAL_COPY: Record<HostRefusal, string> = {
	not_found: 'This party no longer exists.',
	invalid_pin: 'Incorrect PIN. Please try again.',
	locked_out: 'Too many incorrect PINs. Try again in a few minutes.',
	wrong_status: 'This can only be changed before the grid is locked.',
	grid_incomplete: 'All squares must be claimed before the grid can be locked.',
	invalid_input: 'Some of those values are not valid.',
};

/** Copy for the `field` an `invalid_input` refusal names (every field the server names has one). */
export const INPUT_FIELD_COPY: Record<string, string> = {
	host_name: 'Please enter a host name.',
	pin: `PIN must be exactly ${PIN_LENGTH} digits.`,
	square_price: `Square price must be at least ${MIN_SQUARE_PRICE} and under ${SQUARE_PRICE_CEILING.toLocaleString('en-US')}.`,
	splits: 'Each split must be 0–100% and they must add up to 100%.',
	event_name: `Event name must be 1–${MAX_EVENT_NAME_LENGTH} characters.`,
	team_name: `Team names must be 1–${DB_MAX_TEAM_NAME_LENGTH} characters.`,
	teams: 'Choose two different teams for the matchup.',
	team_color: 'Team colors must be valid hex colors.',
	player_name: 'Player name is required.',
	score: 'Scores must be whole numbers of 0 or more.',
};

/** Per-action copy: `failed` for transport or unexpected errors, plus refusal overrides. */
export type HostCopy = { failed: string } & Partial<Record<HostRefusal, string>>;

export function refusalCopy(
	response: { error: HostRefusal; field?: string },
	copy: HostCopy
): string {
	if (copy[response.error]) return copy[response.error] as string;
	if (response.error === 'invalid_input' && response.field && INPUT_FIELD_COPY[response.field]) {
		return INPUT_FIELD_COPY[response.field];
	}
	return REFUSAL_COPY[response.error] ?? copy.failed;
}
