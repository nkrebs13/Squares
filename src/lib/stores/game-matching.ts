// Pure team-name matching between a party's matchup and a live game_scores row.
// A leaf module (types only): game-state uses it for liveScores, game-load for
// live-game auto-detection.

import type { Party, GameScoresRow } from '$lib/types';

/**
 * Determine if the API's home team corresponds to the party's row team.
 * Compares team names (case-insensitive substring match) to handle cases
 * where party uses short names ("Seahawks") and API uses full names
 * ("Seattle Seahawks"). Falls back to home_team_is_row flag.
 */
export function resolveHomeIsRow(gameScores: GameScoresRow, party: Party): boolean {
	const homeLower = gameScores.home_team_name.toLowerCase();
	const awayLower = gameScores.away_team_name.toLowerCase();
	const rowLower = party.team_row_name.toLowerCase();
	const colLower = party.team_col_name.toLowerCase();

	const homeMatchesRow = homeLower.includes(rowLower) || rowLower.includes(homeLower);
	const awayMatchesRow = awayLower.includes(rowLower) || rowLower.includes(awayLower);
	const homeMatchesCol = homeLower.includes(colLower) || colLower.includes(homeLower);
	const awayMatchesCol = awayLower.includes(colLower) || colLower.includes(awayLower);

	// Home team name matches row team → home IS row
	if (homeMatchesRow && !awayMatchesRow) return true;
	// Away team name matches row team → home is NOT row
	if (awayMatchesRow && !homeMatchesRow) return false;
	// Home team name matches col team → home is NOT row
	if (homeMatchesCol && !awayMatchesCol) return false;
	// Away team name matches col team → home IS row
	if (awayMatchesCol && !homeMatchesCol) return true;

	// No name match — fall back to the DB flag
	return party.home_team_is_row ?? true;
}

function teamNameMatches(gameName: string, gameAbbrev: string, partyName: string): boolean {
	const normalizedGameName = gameName.toLowerCase();
	const normalizedAbbrev = gameAbbrev.toLowerCase();
	const normalizedPartyName = partyName.toLowerCase();

	return (
		normalizedGameName.includes(normalizedPartyName) ||
		normalizedPartyName.includes(normalizedGameName) ||
		normalizedAbbrev === normalizedPartyName
	);
}

export function gameScoresMatchParty(
	gameScores: GameScoresRow,
	party: Pick<Party, 'team_row_name' | 'team_col_name'>
): boolean {
	const rowMatchesHome = teamNameMatches(
		gameScores.home_team_name,
		gameScores.home_team_abbrev,
		party.team_row_name
	);
	const rowMatchesAway = teamNameMatches(
		gameScores.away_team_name,
		gameScores.away_team_abbrev,
		party.team_row_name
	);
	const colMatchesHome = teamNameMatches(
		gameScores.home_team_name,
		gameScores.home_team_abbrev,
		party.team_col_name
	);
	const colMatchesAway = teamNameMatches(
		gameScores.away_team_name,
		gameScores.away_team_abbrev,
		party.team_col_name
	);

	return (rowMatchesHome && colMatchesAway) || (rowMatchesAway && colMatchesHome);
}
