-- ============================================================
-- 022: Recalculate quarter scores & winners for all parties
--
-- Migration 020 fixed the home_team_is_row NULL bug that caused
-- swapped row/col scores. This migration re-runs score calculation
-- for all game-linked parties to fix Q1 (and any other already-
-- completed quarter) scores and winners.
--
-- Inlines the logic instead of calling backfill_party_scores to
-- avoid RECORD type issues with dynamic column access.
-- ============================================================

DO $$
DECLARE
  v_rec RECORD;
  v_row_score INT;
  v_col_score INT;
BEGIN
  -- Temporarily set 'complete' parties to 'locked' so auto_update_score
  -- will process them (it requires status IN ('active', 'locked'))
  UPDATE parties SET status = 'locked'
  WHERE game_id IS NOT NULL AND status = 'complete';

  -- Join parties to game_scores and process each quarter explicitly
  FOR v_rec IN
    SELECT p.id AS party_id, p.home_team_is_row,
           g.q1_home, g.q1_away,
           g.q2_home, g.q2_away,
           g.q3_home, g.q3_away,
           g.final_home, g.final_away
    FROM parties p
    JOIN game_scores g ON g.game_id = p.game_id
    WHERE p.game_id IS NOT NULL
    AND p.status IN ('active', 'locked')
  LOOP
    -- Q1
    IF v_rec.q1_home IS NOT NULL THEN
      IF COALESCE(v_rec.home_team_is_row, TRUE) THEN
        v_row_score := v_rec.q1_home; v_col_score := v_rec.q1_away;
      ELSE
        v_row_score := v_rec.q1_away; v_col_score := v_rec.q1_home;
      END IF;
      PERFORM auto_update_score(v_rec.party_id, 'q1', v_row_score, v_col_score);
    END IF;

    -- Q2
    IF v_rec.q2_home IS NOT NULL THEN
      IF COALESCE(v_rec.home_team_is_row, TRUE) THEN
        v_row_score := v_rec.q2_home; v_col_score := v_rec.q2_away;
      ELSE
        v_row_score := v_rec.q2_away; v_col_score := v_rec.q2_home;
      END IF;
      PERFORM auto_update_score(v_rec.party_id, 'q2', v_row_score, v_col_score);
    END IF;

    -- Q3
    IF v_rec.q3_home IS NOT NULL THEN
      IF COALESCE(v_rec.home_team_is_row, TRUE) THEN
        v_row_score := v_rec.q3_home; v_col_score := v_rec.q3_away;
      ELSE
        v_row_score := v_rec.q3_away; v_col_score := v_rec.q3_home;
      END IF;
      PERFORM auto_update_score(v_rec.party_id, 'q3', v_row_score, v_col_score);
    END IF;

    -- Final
    IF v_rec.final_home IS NOT NULL THEN
      IF COALESCE(v_rec.home_team_is_row, TRUE) THEN
        v_row_score := v_rec.final_home; v_col_score := v_rec.final_away;
      ELSE
        v_row_score := v_rec.final_away; v_col_score := v_rec.final_home;
      END IF;
      PERFORM auto_update_score(v_rec.party_id, 'final', v_row_score, v_col_score);
    END IF;
  END LOOP;

  -- auto_update_score automatically sets status = 'complete' for
  -- parties whose game has a final score. Parties whose game is
  -- still in progress stay 'locked' (correct).
END;
$$;
