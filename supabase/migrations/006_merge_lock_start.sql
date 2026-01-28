-- Merge lock and start into single action
-- Lock now sets status directly to 'active' instead of 'locked'

CREATE OR REPLACE FUNCTION lock_party(
    p_party_id UUID,
    p_pin VARCHAR(4)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_host_pin VARCHAR(4);
    v_filled_count INTEGER;
    v_row_nums INTEGER[];
    v_col_nums INTEGER[];
BEGIN
    SELECT status, host_pin INTO v_party_status, v_host_pin
    FROM parties WHERE id = p_party_id;

    IF v_host_pin != p_pin THEN
        RETURN FALSE;
    END IF;

    IF v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_filled_count
    FROM squares
    WHERE party_id = p_party_id AND player_name IS NOT NULL;

    IF v_filled_count != 100 THEN
        RETURN FALSE;
    END IF;

    SELECT array_agg(n ORDER BY random()) INTO v_row_nums
    FROM generate_series(0, 9) AS n;

    SELECT array_agg(n ORDER BY random()) INTO v_col_nums
    FROM generate_series(0, 9) AS n;

    INSERT INTO numbers (party_id, row_numbers, col_numbers)
    VALUES (p_party_id, v_row_nums, v_col_nums);

    -- Set directly to 'active' instead of 'locked'
    UPDATE parties
    SET status = 'active'
    WHERE id = p_party_id;

    INSERT INTO scores (party_id)
    VALUES (p_party_id)
    ON CONFLICT (party_id) DO NOTHING;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
