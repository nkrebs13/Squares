-- Batch claim squares function
CREATE OR REPLACE FUNCTION claim_squares_batch(
    p_party_id UUID,
    p_player_name VARCHAR(50),
    p_cells JSONB -- Array of {row, col} objects
)
RETURNS INTEGER AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_cell JSONB;
    v_claimed_count INTEGER := 0;
BEGIN
    -- Check party status
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status != 'filling' THEN
        RETURN 0;
    END IF;

    -- Update all unclaimed squares in the batch
    UPDATE squares
    SET player_name = p_player_name, claimed_at = NOW()
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
