/** Shared domain limits. One home for values that were previously repeated as magic numbers. */

/** The grid is GRID_SIZE x GRID_SIZE squares. */
export const GRID_SIZE = 10;
export const TOTAL_SQUARES = GRID_SIZE * GRID_SIZE;

/** A host PIN is exactly this many digits. */
export const PIN_LENGTH = 4;
/** Wrong host-PIN guesses allowed in the admin PIN gate before it locks. */
export const MAX_PIN_ATTEMPTS = 5;

/**
 * Max length of a player or host name in the UI. Kept at 20 so names fit inside the
 * grid cells; the DB column is VARCHAR(50) on purpose (see CLAUDE.md, UI / DB asymmetry).
 */
export const MAX_NAME_LENGTH = 20;
export const MAX_NICKNAME_LENGTH = 30;
export const MAX_EVENT_NAME_LENGTH = 80;
