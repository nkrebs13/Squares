-- Update host_pin to 4 digits
ALTER TABLE parties ALTER COLUMN host_pin TYPE VARCHAR(4);

-- Update lock_party function to use 4-digit PIN
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

    UPDATE parties
    SET status = 'locked'
    WHERE id = p_party_id;

    INSERT INTO scores (party_id)
    VALUES (p_party_id)
    ON CONFLICT (party_id) DO NOTHING;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update start_game function
CREATE OR REPLACE FUNCTION start_game(
    p_party_id UUID,
    p_pin VARCHAR(4)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_host_pin VARCHAR(4);
BEGIN
    SELECT status, host_pin INTO v_party_status, v_host_pin
    FROM parties WHERE id = p_party_id;

    IF v_host_pin != p_pin THEN
        RETURN FALSE;
    END IF;

    IF v_party_status != 'locked' THEN
        RETURN FALSE;
    END IF;

    UPDATE parties
    SET status = 'active'
    WHERE id = p_party_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;

-- Update update_score function
CREATE OR REPLACE FUNCTION update_score(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_quarter VARCHAR(10),
    p_row_score INTEGER,
    p_col_score INTEGER
)
RETURNS BOOLEAN AS $$
DECLARE
    v_host_pin VARCHAR(4);
    v_row_nums INTEGER[];
    v_col_nums INTEGER[];
    v_winning_row INTEGER;
    v_winning_col INTEGER;
    v_winner_name VARCHAR(50);
    v_prize_amount DECIMAL(10, 2);
    v_total_pot DECIMAL(10, 2);
    v_split INTEGER;
BEGIN
    SELECT host_pin INTO v_host_pin FROM parties WHERE id = p_party_id;
    IF v_host_pin != p_pin THEN
        RETURN FALSE;
    END IF;

    SELECT row_numbers, col_numbers INTO v_row_nums, v_col_nums
    FROM numbers WHERE party_id = p_party_id;

    IF v_row_nums IS NULL THEN
        RETURN FALSE;
    END IF;

    v_winning_row := p_row_score % 10;
    v_winning_col := p_col_score % 10;

    IF p_quarter = 'q1' THEN
        UPDATE scores SET q1_row_score = p_row_score, q1_col_score = p_col_score WHERE party_id = p_party_id;
    ELSIF p_quarter = 'q2' THEN
        UPDATE scores SET q2_row_score = p_row_score, q2_col_score = p_col_score WHERE party_id = p_party_id;
    ELSIF p_quarter = 'q3' THEN
        UPDATE scores SET q3_row_score = p_row_score, q3_col_score = p_col_score WHERE party_id = p_party_id;
    ELSIF p_quarter = 'final' THEN
        UPDATE scores SET final_row_score = p_row_score, final_col_score = p_col_score WHERE party_id = p_party_id;
        UPDATE parties SET status = 'complete' WHERE id = p_party_id;
    END IF;

    SELECT
        array_position(v_row_nums, v_winning_row) - 1,
        array_position(v_col_nums, v_winning_col) - 1
    INTO v_winning_row, v_winning_col;

    SELECT player_name INTO v_winner_name
    FROM squares
    WHERE party_id = p_party_id
        AND row_num = v_winning_row
        AND col_num = v_winning_col;

    SELECT square_price * 100,
           CASE p_quarter
               WHEN 'q1' THEN split_q1
               WHEN 'q2' THEN split_q2
               WHEN 'q3' THEN split_q3
               WHEN 'final' THEN split_final
           END
    INTO v_total_pot, v_split
    FROM parties WHERE id = p_party_id;

    v_prize_amount := v_total_pot * v_split / 100;

    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name, v_prize_amount)
    ON CONFLICT (party_id, quarter)
    DO UPDATE SET winning_row = EXCLUDED.winning_row,
                  winning_col = EXCLUDED.winning_col,
                  player_name = EXCLUDED.player_name,
                  amount = EXCLUDED.amount;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
