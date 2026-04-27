/**
 * Hand-maintained Supabase Database type, focused on RPC signatures.
 *
 * Why hand-maintained: `supabase gen types typescript --local` requires a
 * running local Supabase (Docker) instance, which is environment-dependent
 * and noisy in CI. The Functions surface here is small (8 RPCs) and changes
 * only when a new migration adds an RPC, so the maintenance burden is low.
 *
 * To regenerate from a real local instance instead, run:
 *   `npm run db:types`
 * (Requires `supabase start` to be running; will overwrite this file.)
 *
 * Tables and Views are intentionally typed loosely (`Record<string, unknown>`
 * rows). Per-call typing is done via the `parseXxx` validators in
 * src/lib/validators/realtime.ts so a schema change is caught at runtime
 * with a Sentry breadcrumb rather than as a silent compile-time pass.
 */

import type { Party } from './types';

export interface Database {
	public: {
		Tables: Record<
			string,
			{
				Row: Record<string, unknown>;
				Insert: Record<string, unknown>;
				Update: Record<string, unknown>;
			}
		>;
		Views: Record<string, { Row: Record<string, unknown> }>;
		Functions: {
			create_party: {
				Args: {
					p_host_name: string;
					p_pin: string;
					p_square_price: number;
					p_split_q1: number;
					p_split_q2: number;
					p_split_q3: number;
					p_split_final: number;
					p_team_row_name?: string;
					p_team_col_name?: string;
					p_team_row_color?: string;
					p_team_col_color?: string;
				};
				Returns: Party;
			};
			claim_square: {
				Args: {
					p_party_id: string;
					p_row: number;
					p_col: number;
					p_player_name: string;
				};
				Returns: boolean;
			};
			unclaim_square: {
				Args: {
					p_party_id: string;
					p_row: number;
					p_col: number;
					p_player_name: string;
				};
				Returns: boolean;
			};
			claim_squares_batch: {
				Args: {
					p_party_id: string;
					p_player_name: string;
					p_cells: Array<{ row: number; col: number }>;
				};
				Returns: number;
			};
			lock_party: {
				Args: { p_party_id: string; p_pin: string };
				Returns: boolean;
			};
			update_score: {
				Args: {
					p_party_id: string;
					p_pin: string;
					p_quarter: 'q1' | 'q2' | 'q3' | 'final';
					p_row_score: number;
					p_col_score: number;
				};
				Returns: boolean;
			};
			verify_host_pin: {
				Args: { p_party_code: string; p_pin: string };
				Returns: boolean;
			};
			delete_party: {
				Args: { p_party_id: string; p_pin: string };
				Returns: boolean;
			};
		};
		Enums: Record<string, never>;
	};
}
