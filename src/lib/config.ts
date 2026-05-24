import { env } from '$env/dynamic/public';
import {
	DEFAULT_APP_DESCRIPTION,
	DEFAULT_APP_NAME,
	DEFAULT_APP_TAGLINE,
	DEFAULT_APP_URL,
	DEFAULT_DEMO_PARTY_CODE,
} from '$lib/app-defaults';

/** Validate a CSS hex color from env config; fall back to the literal default if malformed. */
function safeColor(value: string, fallback: string): string {
	return /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

export const APP_CONFIG = {
	/** Override with PUBLIC_APP_NAME. Recommended max 20 chars to avoid hero overflow. */
	appName: env.PUBLIC_APP_NAME || DEFAULT_APP_NAME,

	/** Override with PUBLIC_APP_URL. Used for canonical and share metadata. */
	appUrl: env.PUBLIC_APP_URL || DEFAULT_APP_URL,

	/** Override with PUBLIC_APP_TAGLINE. Shown as the home-page hero subtitle. */
	appTagline: env.PUBLIC_APP_TAGLINE || DEFAULT_APP_TAGLINE,

	/** Override with PUBLIC_APP_DESCRIPTION. Used in OG/Twitter meta tags. */
	appDescription: env.PUBLIC_APP_DESCRIPTION || DEFAULT_APP_DESCRIPTION,

	/** Override with PUBLIC_DEMO_PARTY_CODE. Used by the home-page demo CTA. */
	demoPartyCode: env.PUBLIC_DEMO_PARTY_CODE || DEFAULT_DEMO_PARTY_CODE,

	/** Default team labels seeded into the create-party form. */
	defaultTeams: {
		row: {
			/** Override with PUBLIC_DEFAULT_TEAM_ROW_NAME. */
			name: env.PUBLIC_DEFAULT_TEAM_ROW_NAME || 'Seahawks',
			/** Override with PUBLIC_DEFAULT_TEAM_ROW_COLOR. CSS color string. */
			color: safeColor(env.PUBLIC_DEFAULT_TEAM_ROW_COLOR || '#69BE28', '#69BE28'),
			/** Override with PUBLIC_DEFAULT_TEAM_ROW_LOGO. Path to logo image. */
			logoUrl: env.PUBLIC_DEFAULT_TEAM_ROW_LOGO || '/logos/seahawks.png',
		},
		col: {
			/** Override with PUBLIC_DEFAULT_TEAM_COL_NAME. */
			name: env.PUBLIC_DEFAULT_TEAM_COL_NAME || 'Patriots',
			/** Override with PUBLIC_DEFAULT_TEAM_COL_COLOR. CSS color string. */
			color: safeColor(env.PUBLIC_DEFAULT_TEAM_COL_COLOR || '#C60C30', '#C60C30'),
			/** Override with PUBLIC_DEFAULT_TEAM_COL_LOGO. Path to logo image. */
			logoUrl: env.PUBLIC_DEFAULT_TEAM_COL_LOGO || '/logos/patriots.png',
		},
	},

	/** Locale-flexible currency formatting. */
	currency: {
		/** ISO 4217 code. Override with PUBLIC_CURRENCY_CODE. */
		code: env.PUBLIC_CURRENCY_CODE || 'USD',
		/** BCP 47 locale. Override with PUBLIC_LOCALE. */
		locale: env.PUBLIC_LOCALE || 'en-US',
	},
} as const;

/** Name + color subset used to pre-populate the create-party form. logoUrl is intentionally
 *  omitted — it's display-only and sourced from APP_CONFIG.defaultTeams directly. */
export const DEFAULT_TEAMS = {
	row: { name: APP_CONFIG.defaultTeams.row.name, color: APP_CONFIG.defaultTeams.row.color },
	col: { name: APP_CONFIG.defaultTeams.col.name, color: APP_CONFIG.defaultTeams.col.color },
} as const;
