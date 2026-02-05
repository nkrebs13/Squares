-- ============================================================
-- 021: Fix propagate_game_scores TG_OP check
--
-- Migration 020 introduced a bug where OLD is accessed without
-- checking TG_OP first. This fails on INSERT operations because
-- OLD is undefined for INSERT triggers. This migration fixes
-- the trigger to check TG_OP before accessing OLD.
-- ============================================================

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
