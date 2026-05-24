/**
 * Supabase Database type — RPC contract documentation.
 *
 * This file documents the public RPC surface for code review. It's NOT
 * wired through `createClient<Database>` because Supabase's generated
 * type structure is more elaborate than a hand-written file can replicate
 * accurately (the `@supabase/supabase-js` types expect specific
 * Insert/Update/Relationships shapes per table that vary subtly between
 * versions).
 *
 * To get full type-safe RPCs + table queries, regenerate from a live
 * local Supabase instance:
 *
 *   supabase start          # Docker required
 *   npm run db:types        # writes src/lib/database.types.ts
 *
 * Then add `import type { Database } from './database.types';` and pass
 * it to `createClient<Database>(...)` in supabase.ts.
 */

import type { Party, Quarter } from './types';

export interface DatabaseRpcContract {
	create_party: {
		Args: {
			p_event_name?: string;
			p_kickoff_at?: string | null;
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
		Args: { p_party_id: string; p_row: number; p_col: number; p_player_name: string };
		Returns: boolean;
	};
	unclaim_square: {
		Args: { p_party_id: string; p_row: number; p_col: number; p_player_name: string };
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
			p_quarter: Quarter;
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
}
