-- Migration 014: Restore audit logging lost in migration 011 and harden push RLS
--
-- 1. Restore audit logging to lock_party, update_score, delete_party
-- 2. Drop overly permissive anon SELECT policy on push_subscriptions
-- 3. Tighten INSERT policy to require player has claimed squares

-- ============================================================
-- 1. Restore lock_party with audit logging
-- ============================================================
CREATE OR REPLACE FUNCTION lock_party(p_party_id UUID, p_pin VARCHAR(4))
RETURNS BOOLEAN AS $$
DECLARE
  v_party RECORD;
  v_pin_ok BOOLEAN;
BEGIN
  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    PERFORM log_audit_event('lock_party_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_pin_or_lockout'));
    RETURN FALSE;
  END IF;

  -- Get party for status check
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status != 'filling' THEN
    PERFORM log_audit_event('lock_party_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_status', 'status', COALESCE(v_party.status, 'not_found')));
    RETURN FALSE;
  END IF;

  -- Verify all squares are filled
  IF EXISTS (
    SELECT 1 FROM squares
    WHERE party_id = p_party_id AND player_name IS NULL
  ) THEN
    PERFORM log_audit_event('lock_party_failed', p_party_id,
      jsonb_build_object('reason', 'incomplete_grid'));
    RETURN FALSE;
  END IF;

  -- Generate random numbers (0-9 for each position)
  INSERT INTO numbers (party_id, row_numbers, col_numbers)
  VALUES (
    p_party_id,
    (SELECT array_agg(n ORDER BY random()) FROM generate_series(0, 9) AS n),
    (SELECT array_agg(n ORDER BY random()) FROM generate_series(0, 9) AS n)
  )
  ON CONFLICT (party_id) DO UPDATE SET
    row_numbers = EXCLUDED.row_numbers,
    col_numbers = EXCLUDED.col_numbers,
    assigned_at = NOW();

  -- Update party status to active
  UPDATE parties SET status = 'active', updated_at = NOW() WHERE id = p_party_id;

  PERFORM log_audit_event('lock_party_success', p_party_id, NULL);
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 2. Restore update_score with audit logging
-- ============================================================
CREATE OR REPLACE FUNCTION update_score(
  p_party_id UUID,
  p_pin VARCHAR(4),
  p_quarter VARCHAR(10),
  p_row_score INT,
  p_col_score INT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_party RECORD;
  v_pin_ok BOOLEAN;
  v_row_digit INT;
  v_col_digit INT;
  v_winning_row INT;
  v_winning_col INT;
  v_winner_name TEXT;
  v_total_pot NUMERIC;
  v_quarter_pct INT;
  v_amount NUMERIC;
BEGIN
  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    PERFORM log_audit_event('update_score_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_pin_or_lockout'));
    RETURN FALSE;
  END IF;

  -- Get party
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
    RETURN FALSE;
  END IF;

  -- Validate scores are non-negative
  IF p_row_score < 0 OR p_col_score < 0 THEN
    RETURN FALSE;
  END IF;

  -- Update the score
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

  -- Find winning row/col in the numbers grid
  SELECT
    (SELECT idx FROM unnest(n.row_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_row_digit LIMIT 1) - 1,
    (SELECT idx FROM unnest(n.col_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_col_digit LIMIT 1) - 1
  INTO v_winning_row, v_winning_col
  FROM numbers n
  WHERE n.party_id = p_party_id;

  IF v_winning_row IS NOT NULL AND v_winning_col IS NOT NULL THEN
    -- Get winner name
    SELECT player_name INTO v_winner_name
    FROM squares
    WHERE party_id = p_party_id AND row_num = v_winning_row AND col_num = v_winning_col;

    -- Safety check: winner square must have a player
    IF v_winner_name IS NULL THEN
      RETURN FALSE;
    END IF;

    -- Calculate amount
    v_total_pot := v_party.square_price * 100;
    v_amount := v_total_pot * v_quarter_pct / 100;

    -- Insert or update winner
    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name, v_amount)
    ON CONFLICT (party_id, quarter) DO UPDATE SET
      winning_row = EXCLUDED.winning_row,
      winning_col = EXCLUDED.winning_col,
      player_name = EXCLUDED.player_name,
      amount = EXCLUDED.amount;
  END IF;

  -- If final quarter, mark game as complete
  IF p_quarter = 'final' THEN
    UPDATE parties SET status = 'complete', updated_at = NOW() WHERE id = p_party_id;
  END IF;

  PERFORM log_audit_event('update_score_success', p_party_id,
    jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 3. Restore delete_party with audit logging
-- ============================================================
CREATE OR REPLACE FUNCTION delete_party(p_party_id UUID, p_pin VARCHAR(4))
RETURNS BOOLEAN AS $$
DECLARE
  v_pin_ok BOOLEAN;
  v_code VARCHAR(6);
BEGIN
  -- Get party code for logging before deletion
  SELECT code INTO v_code FROM parties WHERE id = p_party_id;

  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    PERFORM log_audit_event('delete_party_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_pin_or_lockout'));
    RETURN FALSE;
  END IF;

  -- Log before delete (since party_id will be gone after)
  PERFORM log_audit_event('delete_party_success', NULL,
    jsonb_build_object('deleted_party_id', p_party_id, 'code', v_code));

  -- Delete the party (cascades to all related tables)
  DELETE FROM parties WHERE id = p_party_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Drop the overly permissive anon SELECT policy
--    (isSubscribed() in push.ts uses PushManager API, not Supabase queries)
-- ============================================================
DROP POLICY IF EXISTS "Anon can read own party subscriptions" ON push_subscriptions;

-- ============================================================
-- 5. Tighten INSERT policy: player must have claimed at least one square
-- ============================================================
DROP POLICY IF EXISTS "Anyone can subscribe" ON push_subscriptions;
CREATE POLICY "Players can subscribe" ON push_subscriptions
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM squares
      WHERE squares.party_id = push_subscriptions.party_id
      AND LOWER(squares.player_name) = LOWER(push_subscriptions.player_name)
    )
  );

-- ============================================================
-- 6. Add UPDATE policy so upsert works on key rotation
-- ============================================================
CREATE POLICY "Anyone can update own subscription" ON push_subscriptions
  FOR UPDATE USING (true) WITH CHECK (true);
