-- Functions in `public` are private unless a migration grants them.
--
-- Supabase's default privileges grant EXECUTE on every new public function to
-- anon and authenticated, and earlier migrations only revoked it FROM PUBLIC, so
-- every internal helper was callable over PostgREST. The worst case was
-- auto_update_score: SECURITY DEFINER with no PIN, so any client could write
-- scores and winners for any active party.
--
-- From here on a function is part of the client API only if it appears in the
-- GRANT list at the bottom of this file (or a later migration's), and
-- src/tests/integration/function-grants.test.ts pins that list.

-- PUBLIC's EXECUTE is a global default, which a per-schema REVOKE cannot remove.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION auto_update_score(UUID, VARCHAR, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION backfill_party_scores(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION check_pin_lockout(UUID, VARCHAR) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION check_push_subscription_limit() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION log_audit_event(VARCHAR, UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION propagate_game_scores() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public_party_json(parties) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION update_updated_at() FROM PUBLIC, anon, authenticated;

-- No caller anywhere, no PIN lockout, and the only way out of the never-set
-- `locked` status.
DROP FUNCTION IF EXISTS start_game(UUID, VARCHAR);

-- Push subscriptions: the table was writable by anon with DELETE USING (true)
-- and UPDATE USING (true), so any client could delete every subscription or
-- repoint another player's endpoint. Subscribing now goes through one RPC that
-- only inserts or refreshes the caller's own (party, endpoint) row.
DROP POLICY IF EXISTS "Anyone can unsubscribe by endpoint" ON push_subscriptions;
DROP POLICY IF EXISTS "Update subscription with valid player" ON push_subscriptions;
DROP POLICY IF EXISTS "Players can subscribe" ON push_subscriptions;
REVOKE ALL ON TABLE push_subscriptions FROM anon, authenticated;

CREATE OR REPLACE FUNCTION save_push_subscription(
    p_party_id UUID,
    p_player_name VARCHAR(50),
    p_endpoint TEXT,
    p_p256dh TEXT,
    p_auth TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM squares
        WHERE party_id = p_party_id
          AND player_name_lower = LOWER(TRIM(p_player_name))
    ) THEN
        RETURN FALSE;
    END IF;

    INSERT INTO push_subscriptions (party_id, player_name, endpoint, p256dh, auth)
    VALUES (p_party_id, TRIM(p_player_name), p_endpoint, p_p256dh, p_auth)
    ON CONFLICT (party_id, endpoint) DO UPDATE
        SET player_name = EXCLUDED.player_name,
            p256dh = EXCLUDED.p256dh,
            auth = EXCLUDED.auth;

    RETURN TRUE;
END;
$$;

-- The client API. Keep in sync with function-grants.test.ts.
GRANT EXECUTE ON FUNCTION claim_square(UUID, INT, INT, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION claim_squares_batch(UUID, VARCHAR, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION create_party(VARCHAR, VARCHAR, DECIMAL, INT, INT, INT, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION delete_party(UUID, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION lock_party(UUID, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION remove_player(UUID, VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION save_push_subscription(UUID, VARCHAR, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION sync_party_home_team_mapping(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION unclaim_square(UUID, INT, INT, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_party_details(UUID, VARCHAR, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_payout_structure(UUID, VARCHAR, INT, INT, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION update_score(UUID, VARCHAR, VARCHAR, INT, INT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION verify_host_pin(VARCHAR, VARCHAR) TO anon, authenticated;
