-- ============================================================
-- 020: Fix home_team_is_row NULL handling
--
-- The home_team_is_row column allows NULL but has DEFAULT TRUE.
-- When NULL, the IF conditions in triggers/functions treat it
-- as false, causing incorrect row/col mapping. This migration:
-- 1. Backfills any NULL values to TRUE
-- 2. Makes the column NOT NULL
-- 3. Updates functions to use COALESCE for safety
-- ============================================================

-- 1. Backfill NULL values to TRUE (the default)
UPDATE parties SET home_team_is_row = TRUE WHERE home_team_is_row IS NULL;

-- 2. Make the column NOT NULL to prevent future NULLs
ALTER TABLE parties ALTER COLUMN home_team_is_row SET NOT NULL;

-- 3. Update propagate_game_scores trigger function with COALESCE
CREATE OR REPLACE FUNCTION propagate_game_scores() RETURNS TRIGGER AS $$
DECLARE
  v_party RECORD;
  v_new_home INT;
  v_old_home INT;
  v_row_score INT;
  v_col_score INT;
  v_q TEXT;
  v_quarters TEXT[] := ARRAY['q1', 'q2', 'q3', 'final'];
BEGIN
  FOR v_party IN
    SELECT id, home_team_is_row FROM parties
    WHERE game_id = NEW.game_id AND status IN ('locked', 'active')
  LOOP
    FOR v_q IN SELECT unnest(v_quarters) LOOP
      EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_new_home USING NEW;

      -- OLD is only defined for UPDATE operations, not INSERT
      IF TG_OP = 'UPDATE' THEN
        EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_old_home USING OLD;
      ELSE
        v_old_home := NULL;
      END IF;

      -- Only fire on first non-null value for this quarter (quarter just ended)
      IF v_new_home IS NOT NULL AND v_old_home IS NULL THEN
        -- Use COALESCE for safety, even though column is now NOT NULL
        IF COALESCE(v_party.home_team_is_row, TRUE) THEN
          v_row_score := v_new_home;
          EXECUTE format('SELECT ($1).%I', v_q || '_away') INTO v_col_score USING NEW;
        ELSE
          EXECUTE format('SELECT ($1).%I', v_q || '_away') INTO v_row_score USING NEW;
          v_col_score := v_new_home;
        END IF;

        PERFORM auto_update_score(v_party.id, v_q, v_row_score, v_col_score);
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Update backfill_party_scores with COALESCE
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
      -- Use COALESCE for safety, even though column is now NOT NULL
      IF COALESCE(v_party.home_team_is_row, TRUE) THEN
        v_row_score := v_home; v_col_score := v_away;
      ELSE
        v_row_score := v_away; v_col_score := v_home;
      END IF;

      PERFORM auto_update_score(p_party_id, v_q, v_row_score, v_col_score);
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Re-apply REVOKE (function was replaced)
REVOKE EXECUTE ON FUNCTION backfill_party_scores(UUID) FROM PUBLIC;
