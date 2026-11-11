-- One scoring path for manual and live scores.
--
-- update_score (host, PIN) and auto_update_score (live game_scores trigger)
-- were two ~60-line copies of the same rule, and both RETURNed FALSE after
-- writing the score when the winning square had no owner, leaving a score
-- without a winner. record_quarter_score holds the rule once and RAISEs on
-- that integrity fault so the write rolls back.

-- Records one quarter's score and its winner. Returns NULL on success, or a
-- refusal code: 'wrong_status' (game not running) or 'invalid_input' (bad
-- quarter or score). Locks the party row so concurrent scorers serialize.
CREATE FUNCTION record_quarter_score(
    p_party_id UUID,
    p_quarter TEXT,
    p_row_score INT,
    p_col_score INT
) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_party parties;
    v_winning_row INT;
    v_winning_col INT;
    v_winner_name TEXT;
BEGIN
    SELECT * INTO v_party FROM parties WHERE id = p_party_id FOR UPDATE;
    IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
        RETURN 'wrong_status';
    END IF;

    IF p_quarter IS NULL OR p_quarter <> ALL (ARRAY['q1', 'q2', 'q3', 'final'])
       OR p_row_score IS NULL OR p_col_score IS NULL
       OR p_row_score < 0 OR p_col_score < 0 THEN
        RETURN 'invalid_input';
    END IF;

    -- p_quarter is one of the four names above, so the column names are fixed.
    EXECUTE format('UPDATE scores SET %I = $1, %I = $2 WHERE party_id = $3',
                   p_quarter || '_row_score', p_quarter || '_col_score')
        USING p_row_score, p_col_score, p_party_id;

    -- The winner sits where each team's last digit appears in its numbers.
    SELECT array_position(n.row_numbers, p_row_score % 10) - 1,
           array_position(n.col_numbers, p_col_score % 10) - 1
    INTO v_winning_row, v_winning_col
    FROM numbers n WHERE n.party_id = p_party_id;

    SELECT player_name INTO v_winner_name
    FROM squares
    WHERE party_id = p_party_id AND row_num = v_winning_row AND col_num = v_winning_col;

    IF v_winner_name IS NULL THEN
        RAISE EXCEPTION 'party % has no owner for winning square (%, %) in %',
            p_party_id, v_winning_row, v_winning_col, p_quarter;
    END IF;

    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (
        p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name,
        v_party.square_price * 100 * (to_jsonb(v_party) ->> ('split_' || p_quarter))::INT / 100
    )
    ON CONFLICT (party_id, quarter) DO UPDATE SET
        winning_row = EXCLUDED.winning_row,
        winning_col = EXCLUDED.winning_col,
        player_name = EXCLUDED.player_name,
        amount = EXCLUDED.amount;

    IF p_quarter = 'final' THEN
        UPDATE parties SET status = 'complete' WHERE id = p_party_id;
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION host_record_score(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_quarter VARCHAR(10),
    p_row_score INT,
    p_col_score INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_refusal JSONB;
    v_problem TEXT;
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'record_score');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    v_problem := record_quarter_score(p_party_id, p_quarter, p_row_score, p_col_score);
    IF v_problem IS NOT NULL THEN
        RETURN host_refusal(p_party_id, 'record_score', v_problem,
            CASE WHEN v_problem = 'invalid_input' THEN 'score' END);
    END IF;

    PERFORM log_audit_event('record_score_success', p_party_id,
        jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));

    RETURN jsonb_build_object(
        'ok', true,
        'party', (SELECT public_party_json(p) FROM parties p WHERE p.id = p_party_id),
        'scores', (SELECT to_jsonb(s) FROM scores s WHERE s.party_id = p_party_id),
        'winners', COALESCE(
            (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.quarter) FROM winners w WHERE w.party_id = p_party_id),
            '[]'::jsonb)
    );
END;
$$;

-- The live-score trigger path. Same signature, so propagate_game_scores is
-- unchanged. A fault in one party is contained to that party: its partial
-- write rolls back and the game_scores update that fired the trigger still
-- lands for every other party.
CREATE OR REPLACE FUNCTION auto_update_score(
    p_party_id UUID,
    p_quarter VARCHAR,
    p_row_score INT,
    p_col_score INT
) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_problem TEXT;
BEGIN
    BEGIN
        v_problem := record_quarter_score(p_party_id, p_quarter, p_row_score, p_col_score);
    EXCEPTION WHEN OTHERS THEN
        PERFORM log_audit_event('auto_update_score_failed', p_party_id,
            jsonb_build_object('reason', SQLERRM, 'quarter', p_quarter));
        RETURN FALSE;
    END;

    IF v_problem IS NOT NULL THEN
        PERFORM log_audit_event('auto_update_score_failed', p_party_id,
            jsonb_build_object('reason', v_problem, 'quarter', p_quarter));
        RETURN FALSE;
    END IF;

    PERFORM log_audit_event('auto_update_score_success', p_party_id,
        jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));
    RETURN TRUE;
END;
$$;

GRANT EXECUTE ON FUNCTION host_record_score(UUID, VARCHAR, VARCHAR, INT, INT) TO anon, authenticated;
