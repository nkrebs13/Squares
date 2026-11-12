/** Shared domain limits. */

export const GRID_SIZE = 10;
export const TOTAL_SQUARES = GRID_SIZE * GRID_SIZE;

export const PIN_LENGTH = 4;

/**
 * Max length of a player or host name in the UI. Kept at 20 so names fit inside the
 * grid cells; the DB column is VARCHAR(50) on purpose (see CLAUDE.md, UI / DB asymmetry).
 */
export const MAX_NAME_LENGTH = 20;
export const MAX_NICKNAME_LENGTH = 30;
export const MAX_EVENT_NAME_LENGTH = 80;
/** Team names in the UI (grid headers); the DB column allows 50 (see DB_MAX_TEAM_NAME_LENGTH). */
export const MAX_TEAM_NAME_LENGTH = 30;

// Limits the DB enforces, mirrored here only where user-facing copy states them.
/** `team_*_name` accepts 1..50 characters; the UI input stops at MAX_TEAM_NAME_LENGTH. */
export const DB_MAX_TEAM_NAME_LENGTH = 50;
/** `square_price` must be at least this (host_create_party). */
export const MIN_SQUARE_PRICE = 0.01;
/** `square_price` must stay below this (host_create_party). */
export const SQUARE_PRICE_CEILING = 100_000_000;
