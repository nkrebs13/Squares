-- ============================================================
-- 1. game_scores table (shared live game state, written by API)
-- ============================================================
CREATE TABLE game_scores (
  game_id VARCHAR(20) PRIMARY KEY,
  sport VARCHAR(10) NOT NULL DEFAULT 'nfl',
  home_team_abbrev VARCHAR(10) NOT NULL,
  away_team_abbrev VARCHAR(10) NOT NULL,
  home_team_name VARCHAR(50) NOT NULL,
  away_team_name VARCHAR(50) NOT NULL,
  home_score INTEGER NOT NULL DEFAULT 0,
  away_score INTEGER NOT NULL DEFAULT 0,
  game_clock VARCHAR(10) NOT NULL DEFAULT '',
  game_quarter INTEGER NOT NULL DEFAULT 0,
  game_status VARCHAR(20) NOT NULL DEFAULT 'pregame',
  -- Quarter-end snapshots (set once when quarter completes, never overwritten)
  q1_home INTEGER, q1_away INTEGER,
  q2_home INTEGER, q2_away INTEGER,
  q3_home INTEGER, q3_away INTEGER,
  q4_home INTEGER, q4_away INTEGER,  -- stored but NOT propagated (no q4 payout)
  final_home INTEGER, final_away INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 2. Link parties to a live game
-- ============================================================
ALTER TABLE parties ADD COLUMN game_id VARCHAR(20) REFERENCES game_scores(game_id);
ALTER TABLE parties ADD COLUMN home_team_is_row BOOLEAN DEFAULT TRUE;
CREATE INDEX idx_parties_game_id ON parties(game_id);

-- ============================================================
-- 3. RLS: read-only for anon, service role bypasses RLS for writes
-- ============================================================
ALTER TABLE game_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read game_scores" ON game_scores FOR SELECT USING (true);
-- No write policy needed: service role key bypasses RLS entirely.
-- Adding a write policy here would grant anon write access — intentionally omitted.

ALTER PUBLICATION supabase_realtime ADD TABLE game_scores;

-- ============================================================
-- 4. auto_update_score: like update_score but no PIN, called by trigger
-- ============================================================
CREATE OR REPLACE FUNCTION auto_update_score(
  p_party_id UUID,
  p_quarter VARCHAR(10),
  p_row_score INT,
  p_col_score INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_party RECORD;
  v_row_digit INT;
  v_col_digit INT;
  v_winning_row INT;
  v_winning_col INT;
  v_winner_name TEXT;
  v_total_pot NUMERIC;
  v_quarter_pct INT;
  v_amount NUMERIC;
BEGIN
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
    RETURN FALSE;
  END IF;

  IF p_row_score < 0 OR p_col_score < 0 THEN RETURN FALSE; END IF;

  -- Update the per-party score (same logic as update_score minus PIN)
  IF p_quarter = 'q1' THEN
    UPDATE scores SET q1_row_score = p_row_score, q1_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q1;
  ELSIF p_quarter = 'q2' THEN
    UPDATE scores SET q2_row_score = p_row_score, q2_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q2;
  ELSIF p_quarter = 'q3' THEN
    UPDATE scores SET q3_row_score = p_row_score, q3_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q3;
  ELSIF p_quarter = 'final' THEN
    UPDATE scores SET final_row_score = p_row_score, final_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_final;
  ELSE
    RETURN FALSE;
  END IF;

  -- Calculate winning square
  v_row_digit := p_row_score % 10;
  v_col_digit := p_col_score % 10;

  SELECT
    (SELECT idx FROM unnest(n.row_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_row_digit LIMIT 1) - 1,
    (SELECT idx FROM unnest(n.col_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_col_digit LIMIT 1) - 1
  INTO v_winning_row, v_winning_col
  FROM numbers n WHERE n.party_id = p_party_id;

  IF v_winning_row IS NOT NULL AND v_winning_col IS NOT NULL THEN
    SELECT player_name INTO v_winner_name
    FROM squares WHERE party_id = p_party_id AND row_num = v_winning_row AND col_num = v_winning_col;

    IF v_winner_name IS NULL THEN
      PERFORM log_audit_event('auto_update_score_failed', p_party_id,
        jsonb_build_object('reason', 'null_winner', 'row', v_winning_row, 'col', v_winning_col));
      RETURN FALSE;
    END IF;

    v_total_pot := v_party.square_price * 100;
    v_amount := v_total_pot * v_quarter_pct / 100;

    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name, v_amount)
    ON CONFLICT (party_id, quarter) DO UPDATE SET
      winning_row = EXCLUDED.winning_row, winning_col = EXCLUDED.winning_col,
      player_name = EXCLUDED.player_name, amount = EXCLUDED.amount;
  END IF;

  IF p_quarter = 'final' THEN
    UPDATE parties SET status = 'complete', updated_at = NOW() WHERE id = p_party_id;
  END IF;

  PERFORM log_audit_event('auto_update_score_success', p_party_id,
    jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. Trigger: propagate quarter-end scores to linked parties
--    NOTE: deliberately skips q4 — only q1, q2, q3, final have payouts
-- ============================================================
CREATE OR REPLACE FUNCTION propagate_game_scores() RETURNS TRIGGER AS $$
DECLARE
  v_party RECORD;
  v_row_score INT;
  v_col_score INT;
  v_quarters TEXT[] := ARRAY['q1', 'q2', 'q3', 'final'];
  v_q TEXT;
  v_new_home INT;
  v_old_home INT;
  v_home INT;
  v_away INT;
BEGIN
  FOR v_q IN SELECT unnest(v_quarters) LOOP
    EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_new_home USING NEW;

    IF TG_OP = 'UPDATE' THEN
      EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_old_home USING OLD;
    ELSE
      v_old_home := NULL;
    END IF;

    -- Only propagate on NULL -> value transition (quarter just completed)
    IF v_new_home IS NOT NULL AND (v_old_home IS NULL OR TG_OP = 'INSERT') THEN
      EXECUTE format('SELECT ($1).%I', v_q || '_away') INTO v_away USING NEW;
      v_home := v_new_home;

      FOR v_party IN
        SELECT id, home_team_is_row FROM parties
        WHERE game_id = NEW.game_id AND status IN ('active', 'locked')
      LOOP
        IF v_party.home_team_is_row THEN
          v_row_score := v_home;
          v_col_score := v_away;
        ELSE
          v_row_score := v_away;
          v_col_score := v_home;
        END IF;

        PERFORM auto_update_score(v_party.id, v_q, v_row_score, v_col_score);
      END LOOP;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER game_scores_propagate
  AFTER INSERT OR UPDATE ON game_scores
  FOR EACH ROW
  EXECUTE FUNCTION propagate_game_scores();

-- ============================================================
-- 6. Live score columns on per-party scores table
-- ============================================================
ALTER TABLE scores ADD COLUMN live_row_score INTEGER;
ALTER TABLE scores ADD COLUMN live_col_score INTEGER;
ALTER TABLE scores ADD COLUMN live_clock VARCHAR(10);
ALTER TABLE scores ADD COLUMN live_quarter INTEGER;
ALTER TABLE scores ADD COLUMN live_status VARCHAR(20);

-- ============================================================
-- 7. Trigger: propagate live scores to per-party scores table
--    Maps home/away -> row/col based on party's home_team_is_row
-- ============================================================
CREATE OR REPLACE FUNCTION propagate_live_scores() RETURNS TRIGGER AS $$
BEGIN
  UPDATE scores s SET
    live_row_score = CASE WHEN p.home_team_is_row THEN NEW.home_score ELSE NEW.away_score END,
    live_col_score = CASE WHEN p.home_team_is_row THEN NEW.away_score ELSE NEW.home_score END,
    live_clock = NEW.game_clock,
    live_quarter = NEW.game_quarter,
    live_status = NEW.game_status
  FROM parties p
  WHERE p.game_id = NEW.game_id
    AND p.status IN ('active', 'locked')
    AND s.party_id = p.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER game_scores_live_propagate
  AFTER INSERT OR UPDATE ON game_scores
  FOR EACH ROW
  EXECUTE FUNCTION propagate_live_scores();

-- ============================================================
-- 8. Backfill function: catch up a newly-locked party with
--    any quarters that already completed in game_scores
-- ============================================================
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

  -- Also set current live scores
  UPDATE scores SET
    live_row_score = CASE WHEN v_party.home_team_is_row THEN v_game.home_score ELSE v_game.away_score END,
    live_col_score = CASE WHEN v_party.home_team_is_row THEN v_game.away_score ELSE v_game.home_score END,
    live_clock = v_game.game_clock,
    live_quarter = v_game.game_quarter,
    live_status = v_game.game_status
  WHERE party_id = p_party_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
