export type PartyStatus = 'filling' | 'locked' | 'active' | 'complete';
export type Quarter = 'q1' | 'q2' | 'q3' | 'final';

export interface Party {
	id: string;
	code: string;
	host_pin?: string;
	host_name_lower: string | null;
	square_price: number;
	split_q1: number;
	split_q2: number;
	split_q3: number;
	split_final: number;
	status: PartyStatus;
	team_row_name: string;
	team_col_name: string;
	team_row_color: string;
	team_col_color: string;
	created_at: string;
	updated_at: string;
	expires_at: string;
}

export interface Square {
	id: string;
	party_id: string;
	row_num: number;
	col_num: number;
	player_name: string | null;
	player_name_lower: string | null;
	claimed_at: string | null;
}

export interface Numbers {
	party_id: string;
	row_numbers: number[];
	col_numbers: number[];
	assigned_at: string;
}

export interface Scores {
	party_id: string;
	q1_row_score: number | null;
	q1_col_score: number | null;
	q2_row_score: number | null;
	q2_col_score: number | null;
	q3_row_score: number | null;
	q3_col_score: number | null;
	final_row_score: number | null;
	final_col_score: number | null;
}

export interface Winner {
	id: string;
	party_id: string;
	quarter: Quarter;
	winning_row: number;
	winning_col: number;
	player_name: string;
	amount: number;
	created_at: string;
}

export interface GridState {
	party: Party;
	squares: Square[];
	numbers: Numbers | null;
	scores: Scores | null;
	winners: Winner[];
}

export interface SplitPreset {
	name: string;
	q1: number;
	q2: number;
	q3: number;
	final: number;
}

export const SPLIT_PRESETS: SplitPreset[] = [
	{ name: 'Rising', q1: 10, q2: 20, q3: 30, final: 40 },
	{ name: 'Equal', q1: 25, q2: 25, q3: 25, final: 25 },
	{ name: 'Big Finish', q1: 20, q2: 20, q3: 20, final: 40 },
	{ name: 'Custom', q1: 0, q2: 0, q3: 0, final: 0 },
];

// Super Bowl Teams
export const DEFAULT_TEAMS = {
	row: { name: 'Seahawks', color: '#69BE28' },
	col: { name: 'Patriots', color: '#C60C30' },
};

export interface RecentParty {
	code: string;
	nickname?: string; // user-defined nickname for easy identification
	teamRowName: string;
	teamColName: string;
	lastVisited: number; // timestamp
	status: PartyStatus;
	isHost: boolean;
}

// Optimistic UI types
export interface OptimisticOperation {
	id: string;
	type: 'claim' | 'unclaim';
	row: number;
	col: number;
	timestamp: number;
	status: 'pending' | 'confirmed' | 'failed';
	originalState: {
		player_name: string | null;
		player_name_lower: string | null;
		claimed_at: string | null;
	};
}

export interface BroadcastMessage {
	type: 'claim_intent' | 'claim_rejected' | 'unclaim_intent';
	squareKey: string;
	playerName: string;
	timestamp: number;
	clientId: string;
}
