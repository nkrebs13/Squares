/** The key a player name is compared by (matches the DB's `player_name_lower`). */
export function normalizePlayerName(name: string): string {
	return name.trim().toLowerCase();
}
