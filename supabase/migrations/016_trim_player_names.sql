-- Trim whitespace from player names in all square RPCs
-- Prevents edge cases where " Nathan " and "Nathan" are treated as different users

-- ============================================================================
-- claim_square: TRIM player name before storing
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_rows_affected INTEGER;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check party status first
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    -- Atomic claim: UPDATE only succeeds if square is unclaimed
    UPDATE squares
    SET player_name = v_trimmed_name, claimed_at = NOW()
    WHERE party_id = p_party_id
      AND row_num = p_row
      AND col_num = p_col
      AND player_name IS NULL;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- unclaim_square: TRIM player name before matching
-- ============================================================================
CREATE OR REPLACE FUNCTION unclaim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_rows_affected INTEGER;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Check party status first
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    -- Atomic unclaim: UPDATE only succeeds if player owns the square
    UPDATE squares
    SET player_name = NULL, claimed_at = NULL
    WHERE party_id = p_party_id
      AND row_num = p_row
      AND col_num = p_col
      AND LOWER(player_name) = LOWER(v_trimmed_name);

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- claim_squares_batch: TRIM player name before storing
-- ============================================================================
CREATE OR REPLACE FUNCTION claim_squares_batch(
    p_party_id UUID,
    p_player_name VARCHAR(50),
    p_cells JSONB
)
RETURNS INTEGER AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_claimed_count INTEGER := 0;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN 0;
    END IF;

    -- Check party status
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status != 'filling' THEN
        RETURN 0;
    END IF;

    -- Update all unclaimed squares in the batch
    UPDATE squares
    SET player_name = v_trimmed_name, claimed_at = NOW()
    WHERE party_id = p_party_id
      AND player_name IS NULL
      AND (row_num, col_num) IN (
          SELECT (elem->>'row')::INTEGER, (elem->>'col')::INTEGER
          FROM jsonb_array_elements(p_cells) AS elem
      );

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
    RETURN v_claimed_count;
END;
$$ LANGUAGE plpgsql;
