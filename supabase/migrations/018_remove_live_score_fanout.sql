-- ============================================================
-- 018: Remove live score fan-out
--
-- The frontend now reads game_scores directly via a separate
-- realtime channel, so the per-party live_* columns and the
-- trigger that copied every poll into every party's scores row
-- are no longer needed.
--
-- DEPLOY ORDER: frontend first, then this migration.
-- ============================================================

-- 1. Drop the live-propagation trigger (depends on function)
DROP TRIGGER IF EXISTS game_scores_live_propagate ON game_scores;

-- 2. Drop the live-propagation function
DROP FUNCTION IF EXISTS propagate_live_scores();

-- 3. Drop the live_* columns from per-party scores
ALTER TABLE scores DROP COLUMN IF EXISTS live_row_score;
ALTER TABLE scores DROP COLUMN IF EXISTS live_col_score;
ALTER TABLE scores DROP COLUMN IF EXISTS live_clock;
ALTER TABLE scores DROP COLUMN IF EXISTS live_quarter;
ALTER TABLE scores DROP COLUMN IF EXISTS live_status;

-- 4. Update backfill_party_scores() to remove the live_* UPDATE block
CREATE OR REPLACE FUNCTION backfill_party_scores(p_party_id UUID) RETURNS VOID AS $$
DECLARE
  v_party RECORD;
  v_game RECORD;
  v_quarters TEXT[] := ARRAY['q1', 'q2', 'q3', 'final'];
  v_q TEXT;
  v_home INT;
  v_away INT;
  v_row_score INT;
  v_col_score INT;
BEGIN
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.game_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Propagate any already-completed quarters
  FOR v_q IN SELECT unnest(v_quarters) LOOP
    EXECUTE format('SELECT ($1).%I, ($1).%I', v_q || '_home', v_q || '_away')
      INTO v_home, v_away USING v_game;

    IF v_home IS NOT NULL THEN
      IF v_party.home_team_is_row THEN
        v_row_score := v_home; v_col_score := v_away;
      ELSE
        v_row_score := v_away; v_col_score := v_home;
      END IF;

      PERFORM auto_update_score(p_party_id, v_q, v_row_score, v_col_score);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Restrict backfill function to service role only (called by admin, not public)
REVOKE EXECUTE ON FUNCTION backfill_party_scores(UUID) FROM PUBLIC;
