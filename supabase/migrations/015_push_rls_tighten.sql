-- Migration 015: Tighten push_subscriptions UPDATE policy
--
-- Security review findings:
-- 1. UPDATE policy (USING true, WITH CHECK true) lets any anon user modify
--    any subscription's endpoint/keys/player_name — hijacking notifications.
--    Fix: WITH CHECK must enforce the same player-has-squares condition as INSERT.
-- 2. DELETE policy (USING true) allows mass deletion of all subscriptions.
--    Mitigated by: anon has no SELECT access (dropped in 014), so attackers
--    cannot enumerate rows. Blind mass DELETE via PostgREST is still possible
--    but requires knowing the table name and having the public anon key.
--    Accepted risk for a single-event app; documented here.

-- ============================================================
-- 1. Replace wide-open UPDATE policy
-- ============================================================
DROP POLICY IF EXISTS "Anyone can update own subscription" ON push_subscriptions;

-- Upsert (INSERT ... ON CONFLICT DO UPDATE) requires both INSERT and UPDATE
-- policies to pass. The USING clause allows the ON CONFLICT match to find the
-- existing row; the WITH CHECK clause validates the resulting row state.
CREATE POLICY "Update subscription with valid player" ON push_subscriptions
  FOR UPDATE USING (true)
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM squares
      WHERE squares.party_id = push_subscriptions.party_id
      AND LOWER(squares.player_name) = LOWER(push_subscriptions.player_name)
    )
  );
