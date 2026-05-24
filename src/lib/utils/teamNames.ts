export function normalizeTeamNameForMatchup(name: string): string {
	return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function areDistinctTeamNames(rowTeamName: string, colTeamName: string): boolean {
	const row = normalizeTeamNameForMatchup(rowTeamName);
	const col = normalizeTeamNameForMatchup(colTeamName);
	return row.length > 0 && col.length > 0 && row !== col;
}
