-- 041: Drop the RPCs that only older client bundles called.
--
-- Migrations 035-040 gave every client action a replacement (host_* for host actions,
-- claim_squares for claims, get_party_state for loading, a trigger for the home-team
-- side). The deployed client calls none of the functions below; check_pin_lockout was
-- only ever called by them (host_pin_check replaced it in 035).

DROP FUNCTION IF EXISTS public.claim_square(uuid, integer, integer, character varying);
DROP FUNCTION IF EXISTS public.claim_squares_batch(uuid, character varying, jsonb);
DROP FUNCTION IF EXISTS public.create_party(
	character varying, character varying, numeric, integer, integer, integer, integer,
	character varying, character varying, character varying, character varying,
	character varying, timestamp with time zone
);
DROP FUNCTION IF EXISTS public.update_party_details(
	uuid, character varying, character varying, timestamp with time zone,
	character varying, character varying, character varying, character varying
);
DROP FUNCTION IF EXISTS public.update_score(uuid, character varying, character varying, integer, integer);
DROP FUNCTION IF EXISTS public.verify_host_pin(character varying, character varying);
DROP FUNCTION IF EXISTS public.lock_party(uuid, character varying);
DROP FUNCTION IF EXISTS public.delete_party(uuid, character varying);
DROP FUNCTION IF EXISTS public.remove_player(uuid, character varying, character varying);
DROP FUNCTION IF EXISTS public.update_payout_structure(uuid, character varying, integer, integer, integer, integer);
DROP FUNCTION IF EXISTS public.sync_party_home_team_mapping(uuid);
DROP FUNCTION IF EXISTS public.check_pin_lockout(uuid, character varying);
