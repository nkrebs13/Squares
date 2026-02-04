-- PIN rate limiting: lock out after 5 failed attempts for 5 minutes
ALTER TABLE parties
  ADD COLUMN IF NOT EXISTS pin_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;

-- Helper function: check lockout and increment on failure
CREATE OR REPLACE FUNCTION check_pin_lockout(p_party_id UUID, p_pin VARCHAR(4))
RETURNS BOOLEAN AS $$
DECLARE
  v_party RECORD;
BEGIN
  SELECT host_pin, pin_attempts, pin_locked_until
  INTO v_party
  FROM parties
  WHERE id = p_party_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check if currently locked out
  IF v_party.pin_locked_until IS NOT NULL AND v_party.pin_locked_until > NOW() THEN
    RETURN FALSE;
  END IF;

  -- If lockout expired, reset attempts
  IF v_party.pin_locked_until IS NOT NULL AND v_party.pin_locked_until <= NOW() THEN
    UPDATE parties SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_party_id;
  END IF;

  -- Check PIN
  IF v_party.host_pin = p_pin THEN
    -- Reset attempts on success
    UPDATE parties SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_party_id;
    RETURN TRUE;
  ELSE
    -- Increment failure count
    UPDATE parties
    SET pin_attempts = pin_attempts + 1,
        pin_locked_until = CASE
          WHEN pin_attempts + 1 >= 5 THEN NOW() + INTERVAL '5 minutes'
          ELSE pin_locked_until
        END
    WHERE id = p_party_id;
    RETURN FALSE;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update verify_host_pin to use lockout
CREATE OR REPLACE FUNCTION verify_host_pin(p_party_code VARCHAR(6), p_pin VARCHAR(4))
RETURNS BOOLEAN AS $$
DECLARE
  v_party_id UUID;
BEGIN
  SELECT id INTO v_party_id FROM parties WHERE code = p_party_code;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  RETURN check_pin_lockout(v_party_id, p_pin);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update lock_party to use lockout
CREATE OR REPLACE FUNCTION lock_party(p_party_id UUID, p_pin VARCHAR(4))
RETURNS BOOLEAN AS $$
DECLARE
  v_party RECORD;
  v_pin_ok BOOLEAN;
BEGIN
  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    RETURN FALSE;
  END IF;

  -- Get party for status check
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status != 'filling' THEN
    RETURN FALSE;
  END IF;

  -- Verify all squares are filled
  IF EXISTS (
    SELECT 1 FROM squares
    WHERE party_id = p_party_id AND player_name IS NULL
  ) THEN
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

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update update_score to use lockout
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
    RETURN FALSE;
  END IF;

  -- Get party
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
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

  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update delete_party to use lockout
CREATE OR REPLACE FUNCTION delete_party(p_party_id UUID, p_pin VARCHAR(4))
RETURNS BOOLEAN AS $$
DECLARE
  v_pin_ok BOOLEAN;
BEGIN
  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    RETURN FALSE;
  END IF;

  -- Delete the party (cascades to all related tables)
  DELETE FROM parties WHERE id = p_party_id;
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
