export interface NflTeamPreset {
	id: string;
	name: string;
	color: string;
}

export const NFL_TEAM_PRESETS: NflTeamPreset[] = [
	{ id: 'ari', name: 'Cardinals', color: '#97233F' },
	{ id: 'atl', name: 'Falcons', color: '#A71930' },
	{ id: 'bal', name: 'Ravens', color: '#241773' },
	{ id: 'buf', name: 'Bills', color: '#00338D' },
	{ id: 'car', name: 'Panthers', color: '#0085CA' },
	{ id: 'chi', name: 'Bears', color: '#0B162A' },
	{ id: 'cin', name: 'Bengals', color: '#FB4F14' },
	{ id: 'cle', name: 'Browns', color: '#311D00' },
	{ id: 'dal', name: 'Cowboys', color: '#041E42' },
	{ id: 'den', name: 'Broncos', color: '#FB4F14' },
	{ id: 'det', name: 'Lions', color: '#0076B6' },
	{ id: 'gb', name: 'Packers', color: '#203731' },
	{ id: 'hou', name: 'Texans', color: '#03202F' },
	{ id: 'ind', name: 'Colts', color: '#002C5F' },
	{ id: 'jax', name: 'Jaguars', color: '#006778' },
	{ id: 'kc', name: 'Chiefs', color: '#E31837' },
	{ id: 'lv', name: 'Raiders', color: '#A5ACAF' },
	{ id: 'lac', name: 'Chargers', color: '#0080C6' },
	{ id: 'lar', name: 'Rams', color: '#003594' },
	{ id: 'mia', name: 'Dolphins', color: '#008E97' },
	{ id: 'min', name: 'Vikings', color: '#4F2683' },
	{ id: 'ne', name: 'Patriots', color: '#C60C30' },
	{ id: 'no', name: 'Saints', color: '#D3BC8D' },
	{ id: 'nyg', name: 'Giants', color: '#0B2265' },
	{ id: 'nyj', name: 'Jets', color: '#125740' },
	{ id: 'phi', name: 'Eagles', color: '#004C54' },
	{ id: 'pit', name: 'Steelers', color: '#FFB612' },
	{ id: 'sf', name: '49ers', color: '#AA0000' },
	{ id: 'sea', name: 'Seahawks', color: '#69BE28' },
	{ id: 'tb', name: 'Buccaneers', color: '#D50A0A' },
	{ id: 'ten', name: 'Titans', color: '#4B92DB' },
	{ id: 'was', name: 'Commanders', color: '#5A1414' },
];

export function findNflTeamPreset(id: string): NflTeamPreset | undefined {
	return NFL_TEAM_PRESETS.find((team) => team.id === id);
}

export function findNflTeamPresetId(name: string, color: string): string {
	const normalizedName = name.trim().toLowerCase();
	const normalizedColor = color.trim().toLowerCase();
	return (
		NFL_TEAM_PRESETS.find(
			(team) =>
				team.name.toLowerCase() === normalizedName && team.color.toLowerCase() === normalizedColor
		)?.id ?? ''
	);
}
