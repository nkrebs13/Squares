-- 030: Pin SECURITY DEFINER function search_path.
--
-- SECURITY DEFINER routines execute with the owner's privileges. Pinning the
-- search_path prevents an attacker-controlled schema from shadowing unqualified
-- table or function names inside privileged routines. Supabase installs
-- pgcrypto helpers such as gen_random_bytes in the trusted extensions schema,
-- so include it explicitly for create_party.

ALTER FUNCTION public.log_audit_event(character varying, uuid, jsonb)
  SET search_path = public, extensions;
ALTER FUNCTION public.check_pin_lockout(uuid, character varying)
  SET search_path = public, extensions;
ALTER FUNCTION public.verify_host_pin(character varying, character varying)
  SET search_path = public, extensions;

ALTER FUNCTION public.create_party(
  character varying,
  character varying,
  numeric,
  integer,
  integer,
  integer,
  integer,
  character varying,
  character varying,
  character varying,
  character varying,
  character varying,
  timestamp with time zone
)
  SET search_path = public, extensions;

ALTER FUNCTION public.update_party_details(
  uuid,
  character varying,
  character varying,
  timestamp with time zone,
  character varying,
  character varying,
  character varying,
  character varying
)
  SET search_path = public, extensions;

ALTER FUNCTION public.update_payout_structure(
  uuid,
  character varying,
  integer,
  integer,
  integer,
  integer
)
  SET search_path = public, extensions;

ALTER FUNCTION public.lock_party(uuid, character varying)
  SET search_path = public, extensions;
ALTER FUNCTION public.update_score(
  uuid,
  character varying,
  character varying,
  integer,
  integer
)
  SET search_path = public, extensions;
ALTER FUNCTION public.delete_party(uuid, character varying)
  SET search_path = public, extensions;
ALTER FUNCTION public.auto_update_score(uuid, character varying, integer, integer)
  SET search_path = public, extensions;
ALTER FUNCTION public.propagate_game_scores()
  SET search_path = public, extensions;
ALTER FUNCTION public.backfill_party_scores(uuid)
  SET search_path = public, extensions;

ALTER FUNCTION public.claim_square(uuid, integer, integer, character varying)
  SET search_path = public, extensions;
ALTER FUNCTION public.unclaim_square(uuid, integer, integer, character varying)
  SET search_path = public, extensions;
ALTER FUNCTION public.claim_squares_batch(uuid, character varying, jsonb)
  SET search_path = public, extensions;
ALTER FUNCTION public.remove_player(uuid, character varying, character varying)
  SET search_path = public, extensions;
ALTER FUNCTION public.sync_party_home_team_mapping(uuid)
  SET search_path = public, extensions;
