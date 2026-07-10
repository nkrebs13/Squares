// 'locked' exists in the DB CHECK constraint and frontend rendering but is never
// set by current RPCs — lock_party jumps directly to 'active'. Do not remove it.
export type PartyStatus = 'filling' | 'locked' | 'active' | 'complete';
export type Quarter = 'q1' | 'q2' | 'q3' | 'final';

// Sourced from the `game_scores.game_status` column (migration 017) and the
// ESPN scoreboard API. The known values our code branches on are listed
// explicitly so a `if (status === '...')` typo is caught at compile time.
// New ESPN status values appearing in payloads will fail the realtime
// validator (see src/lib/validators/realtime.ts) — that is the intended
// observability signal rather than a silent passthrough.
export type GameStatus = 'pregame' | 'in_progress' | 'halftime' | 'final';

/** Status values where the game is in progress (grid locked, scores can be entered) */
export function isGameInProgress(status: PartyStatus | undefined): boolean {
	return status === 'active' || status === 'locked';
}

export interface Party {
	id: string;
	code: string;
	host_pin?: string;
	host_name_lower: string | null;
	event_name: string;
	kickoff_at: string | null;
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
	game_id: string | null;
	home_team_is_row: boolean | null;
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

export interface GameScoresRow {
	game_id: string;
	sport: string;
	home_team_abbrev: string;
	away_team_abbrev: string;
	home_team_name: string;
	away_team_name: string;
	home_score: number;
	away_score: number;
	game_clock: string;
	game_quarter: number;
	game_status: GameStatus;
	q1_home: number | null;
	q1_away: number | null;
	q2_home: number | null;
	q2_away: number | null;
	q3_home: number | null;
	q3_away: number | null;
	q4_home: number | null;
	q4_away: number | null;
	final_home: number | null;
	final_away: number | null;
	updated_at: string;
}

export interface LiveScores {
	rowScore: number;
	colScore: number;
	clock: string;
	quarter: number;
	status: GameStatus;
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

// Default teams live in $lib/config (env-overridable). Re-export here for any
// external consumers, but new imports should source directly from $lib/config.
export { DEFAULT_TEAMS } from '$lib/config';

export interface RecentParty {
	code: string;
	nickname?: string; // user-defined nickname for easy identification
	eventName?: string;
	kickoffAt?: string | null;
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
	// Snapshot of selectedPlayerFilter taken when an unclaim is optimistically
	// applied. Optimistically clearing a player's last square recomputes
	// playerSummary, which fires game-state.ts's self-clearing subscription and
	// nulls the filter. If the unclaim is then rejected, the square is restored
	// but the filter would stay lost — so it is restored from this snapshot.
	// Undefined for claim ops (claiming never clears a filter).
	filterSnapshot?: string | null;
}

export interface BroadcastMessage {
	type: 'claim_intent' | 'claim_rejected' | 'unclaim_intent' | 'unclaim_rejected';
	squareKey: string;
	playerName: string;
	timestamp: number;
	clientId: string;
}
