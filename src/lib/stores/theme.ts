import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { DEFAULT_TEAMS } from '$lib/types';

interface TeamColors {
	rowColor: string;
	colColor: string;
	rowName: string;
	colName: string;
}

function createThemeStore() {
	const { subscribe, set, update } = writable<TeamColors>({
		rowColor: DEFAULT_TEAMS.row.color,
		colColor: DEFAULT_TEAMS.col.color,
		rowName: DEFAULT_TEAMS.row.name,
		colName: DEFAULT_TEAMS.col.name,
	});

	return {
		subscribe,
		setTeams: (colors: TeamColors) => {
			if (browser) {
				document.documentElement.style.setProperty('--team-row-color', colors.rowColor);
				document.documentElement.style.setProperty('--team-col-color', colors.colColor);
			}
			set(colors);
		},
	};
}

export const theme = createThemeStore();
