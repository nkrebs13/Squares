-- 042: Remove schema surplus and make tables private by default, like functions (034).
--
-- 1. heartbeat: written by nothing; the keep-alive reads parties.
-- 2. Indexes whose lookups a unique constraint's index already serves.
-- 3. Column defaults nothing uses: every party is inserted by host_create_party, which
--    sets the teams, colours, event name and expiry itself (party_expiry), and the server
--    keeps no brand defaults of its own.
-- 4. anon/authenticated held table privileges RLS happened to block (writes, TRUNCATE,
--    TRIGGER, REFERENCES, MAINTAIN). Clients only ever SELECT; everything else goes through
--    SECURITY DEFINER functions. Revoke the rest so a future permissive policy can't open
--    writes, and stop new tables from granting them by default. SELECT is not revoked on
--    the readable tables: revoking it at table level would also drop the column-level
--    SELECT grants on parties that Realtime relies on.
-- 5. host_verify_pin refused with hand-built objects and never audited a failed PIN; it now
--    refuses through host_refusal like every other host action.

DROP TABLE IF EXISTS public.heartbeat;

DROP INDEX IF EXISTS public.idx_parties_code;               -- parties_code_key
DROP INDEX IF EXISTS public.idx_squares_party;              -- squares_party_id_row_num_col_num_key
DROP INDEX IF EXISTS public.idx_winners_party;              -- winners_party_id_quarter_key
DROP INDEX IF EXISTS public.idx_push_subscriptions_party;   -- push_subscriptions_party_id_endpoint_key

ALTER TABLE public.parties
	ALTER COLUMN team_row_name DROP DEFAULT,
	ALTER COLUMN team_col_name DROP DEFAULT,
	ALTER COLUMN team_row_color DROP DEFAULT,
	ALTER COLUMN team_col_color DROP DEFAULT,
	ALTER COLUMN event_name DROP DEFAULT,
	ALTER COLUMN expires_at DROP DEFAULT;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES, MAINTAIN
	ON public.parties, public.squares, public.numbers, public.scores, public.winners,
	   public.game_scores, public.push_subscriptions
	FROM anon, authenticated;
REVOKE ALL ON public.audit_log FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
	REVOKE ALL ON TABLES FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.host_verify_pin(p_party_code VARCHAR, p_pin VARCHAR)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
	v_party_id UUID;
	v_check TEXT;
BEGIN
	SELECT id INTO v_party_id FROM parties WHERE code = UPPER(p_party_code);
	IF NOT FOUND THEN
		RETURN host_refusal(NULL, 'verify_pin', 'not_found');
	END IF;

	v_check := host_pin_check(v_party_id, p_pin);
	IF v_check <> 'ok' THEN
		RETURN host_refusal(v_party_id, 'verify_pin', v_check);
	END IF;
	RETURN jsonb_build_object('ok', true);
END;
$$;
