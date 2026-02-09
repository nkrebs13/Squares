-- ============================================================
-- 022: Recalculate quarter scores & winners for all parties
--
-- Migration 020 fixed the home_team_is_row NULL bug that caused
-- swapped row/col scores. This migration re-runs the backfill
-- for all game-linked parties to fix Q1 (and any other already-
-- completed quarter) scores and winners.
-- ============================================================

DO $$
DECLARE
  v_party RECORD;
BEGIN
  -- Temporarily set 'complete' parties to 'locked' so auto_update_score
  -- will process them (it requires status IN ('active', 'locked'))
  UPDATE parties SET status = 'locked'
  WHERE game_id IS NOT NULL AND status = 'complete';

  -- Re-run backfill for every party linked to a game
  FOR v_party IN
    SELECT id FROM parties
    WHERE game_id IS NOT NULL
    AND status IN ('active', 'locked')
  LOOP
    PERFORM backfill_party_scores(v_party.id);
  END LOOP;

  -- backfill_party_scores → auto_update_score automatically sets
  -- status = 'complete' for parties whose game has a final score.
  -- Parties whose game is still in progress stay 'locked' (correct).
END;
$$;
