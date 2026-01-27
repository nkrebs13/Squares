/**
 * Football Squares Score Fetcher
 *
 * Runs on Mac Mini M4 every 30 seconds via launchd
 * Fetches live NFL scores from ESPN API and updates Supabase
 *
 * Usage:
 *   npx tsx scripts/score-fetcher/index.ts
 *
 * Environment variables:
 *   SUPABASE_URL - Supabase project URL
 *   SUPABASE_SERVICE_KEY - Supabase service role key (for bypassing RLS)
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY!;
const ESPN_API = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard';

// Super Bowl event ID (update for current year)
const SUPER_BOWL_EVENT_ID = process.env.SUPER_BOWL_EVENT_ID;

interface ESPNCompetitor {
	team: {
		abbreviation: string;
		displayName: string;
	};
	score: string;
	linescores?: Array<{ value: number }>;
}

interface ESPNCompetition {
	competitors: ESPNCompetitor[];
	status: {
		type: {
			name: string;
			completed: boolean;
		};
		period: number;
	};
}

interface ESPNEvent {
	id: string;
	name: string;
	competitions: ESPNCompetition[];
}

interface ESPNResponse {
	events: ESPNEvent[];
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function fetchScores(): Promise<void> {
	console.log(`[${new Date().toISOString()}] Fetching scores...`);

	try {
		// Fetch from ESPN
		const response = await fetch(ESPN_API);
		if (!response.ok) {
			throw new Error(`ESPN API error: ${response.status}`);
		}

		const data: ESPNResponse = await response.json();

		// Find Super Bowl game (or any active game for testing)
		let game: ESPNEvent | undefined;

		if (SUPER_BOWL_EVENT_ID) {
			game = data.events.find((e) => e.id === SUPER_BOWL_EVENT_ID);
		} else {
			// Find any active game for testing
			game = data.events.find(
				(e) => e.competitions[0]?.status?.type?.name === 'STATUS_IN_PROGRESS'
			);
		}

		if (!game) {
			console.log('No active game found');
			await updateHeartbeat();
			return;
		}

		const competition = game.competitions[0];
		const homeTeam = competition.competitors.find((c: any) => c.homeAway === 'home');
		const awayTeam = competition.competitors.find((c: any) => c.homeAway === 'away');

		if (!homeTeam || !awayTeam) {
			console.log('Could not identify teams');
			await updateHeartbeat();
			return;
		}

		console.log(
			`Game: ${awayTeam.team.displayName} @ ${homeTeam.team.displayName}`
		);
		console.log(
			`Score: ${awayTeam.score} - ${homeTeam.score} (Period: ${competition.status.period})`
		);

		// Get all active parties
		const { data: parties, error: partiesError } = await supabase
			.from('parties')
			.select('id, team_row_name, team_col_name')
			.eq('status', 'active');

		if (partiesError) {
			throw partiesError;
		}

		if (!parties || parties.length === 0) {
			console.log('No active parties');
			await updateHeartbeat();
			return;
		}

		// Update scores for each party
		for (const party of parties) {
			// Match teams to row/col (simplified - assumes row = home, col = away)
			// In production, you'd want to match by team name
			const rowScore = parseInt(homeTeam.score) || 0;
			const colScore = parseInt(awayTeam.score) || 0;

			// Determine which quarter scores to update
			const period = competition.status.period;
			const isComplete = competition.status.type.completed;

			const scoreUpdate: Record<string, number | null> = {};

			// Get linescores for quarter-by-quarter scores
			const homeLinescores = homeTeam.linescores || [];
			const awayLinescores = awayTeam.linescores || [];

			if (homeLinescores.length >= 1) {
				scoreUpdate.q1_row_score = homeLinescores[0].value;
				scoreUpdate.q1_col_score = awayLinescores[0]?.value ?? 0;
			}

			if (homeLinescores.length >= 2) {
				// Q2 score is cumulative at halftime
				scoreUpdate.q2_row_score = homeLinescores.slice(0, 2).reduce((a, b) => a + b.value, 0);
				scoreUpdate.q2_col_score = awayLinescores.slice(0, 2).reduce((a, b) => a + (b?.value ?? 0), 0);
			}

			if (homeLinescores.length >= 3) {
				scoreUpdate.q3_row_score = homeLinescores.slice(0, 3).reduce((a, b) => a + b.value, 0);
				scoreUpdate.q3_col_score = awayLinescores.slice(0, 3).reduce((a, b) => a + (b?.value ?? 0), 0);
			}

			if (isComplete || period > 4) {
				scoreUpdate.final_row_score = rowScore;
				scoreUpdate.final_col_score = colScore;
			}

			// Only update if we have scores
			if (Object.keys(scoreUpdate).length > 0) {
				const { error: updateError } = await supabase
					.from('scores')
					.update(scoreUpdate)
					.eq('party_id', party.id);

				if (updateError) {
					console.error(`Error updating party ${party.id}:`, updateError);
				} else {
					console.log(`Updated party ${party.id}`);
				}
			}
		}

		await updateHeartbeat();
	} catch (error) {
		console.error('Error fetching scores:', error);
	}
}

async function updateHeartbeat(): Promise<void> {
	await supabase
		.from('heartbeat')
		.update({ source: 'mac-mini', last_beat: new Date().toISOString() })
		.eq('id', 1);
}

// Run immediately
fetchScores();
