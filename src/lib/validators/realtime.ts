/**
 * Hand-written runtime guards for Supabase postgres_changes payloads and
 * direct table-fetch results.
 *
 * Why this exists:
 *   The Supabase JS client types `payload.new` / `payload.old` as
 *   `Record<string, unknown>`. Casting via `as Square` etc. is a
 *   compile-time fiction — a schema change drops a column and the cast
 *   silently produces a half-populated object that downstream code
 *   trusts. These validators turn that into a defensive runtime check:
 *   parse → if shape matches, return typed object; if not, return null
 *   and let the caller log + skip the update.
 *
 * Why hand-written instead of Zod / Valibot:
 *   Zero runtime dependency, ~150 lines total, and the schema surface is
 *   small (six tables). If the surface grows past ~10 tables, switch to
 *   a schema library.
 */

import type {
	Square,
	Party,
	Numbers,
	Scores,
	Winner,
	GameScoresRow,
	GameStatus,
	PartyStatus,
	Quarter,
} from '$lib/types';

// ── Primitive guards ────────────────────────────────────────────────────────

function isObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStr(v: unknown): v is string {
	return typeof v === 'string';
}

function isStrOrNull(v: unknown): v is string | null {
	return v === null || typeof v === 'string';
}

function isNum(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}

function isNumOrNull(v: unknown): v is number | null {
	return v === null || (typeof v === 'number' && Number.isFinite(v));
}

function isBoolOrNull(v: unknown): v is boolean | null {
	return v === null || typeof v === 'boolean';
}

function isPartyStatus(v: unknown): v is PartyStatus {
	return v === 'filling' || v === 'locked' || v === 'active' || v === 'complete';
}

function isGameStatus(v: unknown): v is GameStatus {
	return v === 'pregame' || v === 'in_progress' || v === 'halftime' || v === 'final';
}

function isQuarter(v: unknown): v is Quarter {
	return v === 'q1' || v === 'q2' || v === 'q3' || v === 'final';
}

function isNumberArray(v: unknown): v is number[] {
	return Array.isArray(v) && v.every(isNum);
}

// Internal helper — emit a structured warning. Side-effect-free in
// environments without a console.
function warn(table: string, payload: unknown, missingOrBad: string): null {
	/* eslint-disable no-console -- diagnostic */
	if (typeof console !== 'undefined' && typeof console.warn === 'function') {
		console.warn(
			`[realtime-validator] ${table} payload failed validation (${missingOrBad}):`,
			payload
		);
	}
	/* eslint-enable no-console */
	return null;
}

// ── Validators ──────────────────────────────────────────────────────────────

export function parseSquare(payload: unknown): Square | null {
	if (!isObject(payload)) return warn('squares', payload, 'not an object');
	const p = payload;
	if (!isStr(p.id)) return warn('squares', p, 'id missing');
	if (!isStr(p.party_id)) return warn('squares', p, 'party_id missing');
	if (!isNum(p.row_num)) return warn('squares', p, 'row_num missing');
	if (!isNum(p.col_num)) return warn('squares', p, 'col_num missing');
	if (!isStrOrNull(p.player_name)) return warn('squares', p, 'player_name not str|null');
	if (!isStrOrNull(p.player_name_lower))
		return warn('squares', p, 'player_name_lower not str|null');
	if (!isStrOrNull(p.claimed_at)) return warn('squares', p, 'claimed_at not str|null');
	return {
		id: p.id,
		party_id: p.party_id,
		row_num: p.row_num,
		col_num: p.col_num,
		player_name: p.player_name,
		player_name_lower: p.player_name_lower,
		claimed_at: p.claimed_at,
	};
}

export function parseParty(payload: unknown): Party | null {
	if (!isObject(payload)) return warn('parties', payload, 'not an object');
	const p = payload;
	if (!isStr(p.id)) return warn('parties', p, 'id missing');
	if (!isStr(p.code)) return warn('parties', p, 'code missing');
	if (!isStrOrNull(p.host_name_lower)) return warn('parties', p, 'host_name_lower not str|null');
	if (!isNum(p.square_price)) return warn('parties', p, 'square_price missing');
	if (!isNum(p.split_q1)) return warn('parties', p, 'split_q1 missing');
	if (!isNum(p.split_q2)) return warn('parties', p, 'split_q2 missing');
	if (!isNum(p.split_q3)) return warn('parties', p, 'split_q3 missing');
	if (!isNum(p.split_final)) return warn('parties', p, 'split_final missing');
	if (!isPartyStatus(p.status)) return warn('parties', p, 'status not in PartyStatus union');
	if (!isStr(p.team_row_name)) return warn('parties', p, 'team_row_name missing');
	if (!isStr(p.team_col_name)) return warn('parties', p, 'team_col_name missing');
	if (!isStr(p.team_row_color)) return warn('parties', p, 'team_row_color missing');
	if (!isStr(p.team_col_color)) return warn('parties', p, 'team_col_color missing');
	if (!isStr(p.created_at)) return warn('parties', p, 'created_at missing');
	if (!isStr(p.updated_at)) return warn('parties', p, 'updated_at missing');
	if (!isStr(p.expires_at)) return warn('parties', p, 'expires_at missing');
	if (!isStrOrNull(p.game_id)) return warn('parties', p, 'game_id not str|null');
	if (!isBoolOrNull(p.home_team_is_row))
		return warn('parties', p, 'home_team_is_row not bool|null');

	const result: Party = {
		id: p.id,
		code: p.code,
		host_name_lower: p.host_name_lower,
		square_price: p.square_price,
		split_q1: p.split_q1,
		split_q2: p.split_q2,
		split_q3: p.split_q3,
		split_final: p.split_final,
		status: p.status,
		team_row_name: p.team_row_name,
		team_col_name: p.team_col_name,
		team_row_color: p.team_row_color,
		team_col_color: p.team_col_color,
		created_at: p.created_at,
		updated_at: p.updated_at,
		expires_at: p.expires_at,
		game_id: p.game_id,
		home_team_is_row: p.home_team_is_row,
	};
	if (isStr(p.host_pin)) result.host_pin = p.host_pin;
	return result;
}

export function parseNumbers(payload: unknown): Numbers | null {
	if (!isObject(payload)) return warn('numbers', payload, 'not an object');
	const p = payload;
	if (!isStr(p.party_id)) return warn('numbers', p, 'party_id missing');
	if (!isNumberArray(p.row_numbers) || p.row_numbers.length !== 10)
		return warn('numbers', p, 'row_numbers not number[10]');
	if (!isNumberArray(p.col_numbers) || p.col_numbers.length !== 10)
		return warn('numbers', p, 'col_numbers not number[10]');
	if (!isStr(p.assigned_at)) return warn('numbers', p, 'assigned_at missing');
	return {
		party_id: p.party_id,
		row_numbers: p.row_numbers,
		col_numbers: p.col_numbers,
		assigned_at: p.assigned_at,
	};
}

export function parseScores(payload: unknown): Scores | null {
	if (!isObject(payload)) return warn('scores', payload, 'not an object');
	const p = payload;
	if (!isStr(p.party_id)) return warn('scores', p, 'party_id missing');
	const intFields = [
		'q1_row_score',
		'q1_col_score',
		'q2_row_score',
		'q2_col_score',
		'q3_row_score',
		'q3_col_score',
		'final_row_score',
		'final_col_score',
	] as const;
	for (const field of intFields) {
		if (!isNumOrNull(p[field])) return warn('scores', p, `${field} not number|null`);
	}
	return {
		party_id: p.party_id,
		q1_row_score: p.q1_row_score as number | null,
		q1_col_score: p.q1_col_score as number | null,
		q2_row_score: p.q2_row_score as number | null,
		q2_col_score: p.q2_col_score as number | null,
		q3_row_score: p.q3_row_score as number | null,
		q3_col_score: p.q3_col_score as number | null,
		final_row_score: p.final_row_score as number | null,
		final_col_score: p.final_col_score as number | null,
	};
}

export function parseWinner(payload: unknown): Winner | null {
	if (!isObject(payload)) return warn('winners', payload, 'not an object');
	const p = payload;
	if (!isStr(p.id)) return warn('winners', p, 'id missing');
	if (!isStr(p.party_id)) return warn('winners', p, 'party_id missing');
	if (!isQuarter(p.quarter)) return warn('winners', p, 'quarter not in Quarter union');
	if (!isNum(p.winning_row)) return warn('winners', p, 'winning_row missing');
	if (!isNum(p.winning_col)) return warn('winners', p, 'winning_col missing');
	if (!isStr(p.player_name)) return warn('winners', p, 'player_name missing');
	if (!isNum(p.amount)) return warn('winners', p, 'amount missing');
	if (!isStr(p.created_at)) return warn('winners', p, 'created_at missing');
	return {
		id: p.id,
		party_id: p.party_id,
		quarter: p.quarter,
		winning_row: p.winning_row,
		winning_col: p.winning_col,
		player_name: p.player_name,
		amount: p.amount,
		created_at: p.created_at,
	};
}

export function parseWinnerArray(payload: unknown): Winner[] | null {
	if (!Array.isArray(payload)) return warn('winners[]', payload, 'not an array');
	const result: Winner[] = [];
	for (const row of payload) {
		const parsed = parseWinner(row);
		if (parsed === null) return null; // bail on first invalid row
		result.push(parsed);
	}
	return result;
}

export function parseGameScores(payload: unknown): GameScoresRow | null {
	if (!isObject(payload)) return warn('game_scores', payload, 'not an object');
	const p = payload;
	const requiredStr = [
		'game_id',
		'sport',
		'home_team_abbrev',
		'away_team_abbrev',
		'home_team_name',
		'away_team_name',
		'game_clock',
		'updated_at',
	] as const;
	for (const f of requiredStr) {
		if (!isStr(p[f])) return warn('game_scores', p, `${f} missing`);
	}
	if (!isGameStatus(p.game_status)) {
		return warn('game_scores', p, 'game_status not in GameStatus union');
	}
	const requiredNum = ['home_score', 'away_score', 'game_quarter'] as const;
	for (const f of requiredNum) {
		if (!isNum(p[f])) return warn('game_scores', p, `${f} missing`);
	}
	const optionalNum = [
		'q1_home',
		'q1_away',
		'q2_home',
		'q2_away',
		'q3_home',
		'q3_away',
		'q4_home',
		'q4_away',
		'final_home',
		'final_away',
	] as const;
	for (const f of optionalNum) {
		if (!isNumOrNull(p[f])) return warn('game_scores', p, `${f} not number|null`);
	}
	return {
		game_id: p.game_id as string,
		sport: p.sport as string,
		home_team_abbrev: p.home_team_abbrev as string,
		away_team_abbrev: p.away_team_abbrev as string,
		home_team_name: p.home_team_name as string,
		away_team_name: p.away_team_name as string,
		home_score: p.home_score as number,
		away_score: p.away_score as number,
		game_clock: p.game_clock as string,
		game_quarter: p.game_quarter as number,
		game_status: p.game_status,
		q1_home: p.q1_home as number | null,
		q1_away: p.q1_away as number | null,
		q2_home: p.q2_home as number | null,
		q2_away: p.q2_away as number | null,
		q3_home: p.q3_home as number | null,
		q3_away: p.q3_away as number | null,
		q4_home: p.q4_home as number | null,
		q4_away: p.q4_away as number | null,
		final_home: p.final_home as number | null,
		final_away: p.final_away as number | null,
		updated_at: p.updated_at as string,
	};
}
