-- Claims answer with what actually happened.
--
-- claim_square returned FALSE and claim_squares_batch returned only a count,
-- so after a short batch the client refetched every square to work out which
-- cells it lost and who took them. claim_squares claims any set of cells (one
-- cell for a tap) and returns the cells it claimed and, for each cell it could
-- not, the current owner.
--
-- claim_square / claim_squares_batch stay for older bundles until the legacy
-- functions are dropped.

CREATE FUNCTION claim_squares(
    p_party_id UUID,
    p_player_name VARCHAR(50),
    p_cells JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_name TEXT := TRIM(p_player_name);
    v_status TEXT;
    v_claimed JSONB;
    v_taken JSONB;
BEGIN
    IF COALESCE(v_name, '') = '' OR length(v_name) > 50 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'player_name');
    END IF;

    IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) = 0
       OR jsonb_array_length(p_cells) > 100
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_cells) AS c
           WHERE jsonb_typeof(c -> 'row') IS DISTINCT FROM 'number'
              OR jsonb_typeof(c -> 'col') IS DISTINCT FROM 'number'
              OR (c ->> 'row')::NUMERIC NOT IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9)
              OR (c ->> 'col')::NUMERIC NOT IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9)
       ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'cells');
    END IF;

    -- A plain read is enough: claims only fill empty squares, and host_lock_party
    -- refuses while any square is empty, so a claim racing the lock cannot leave
    -- a locked grid with a hole.
    SELECT status INTO v_status FROM parties WHERE id = p_party_id;
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF v_status <> 'filling' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'wrong_status');
    END IF;

    WITH requested AS (
        SELECT DISTINCT (c ->> 'row')::INT AS row_num, (c ->> 'col')::INT AS col_num
        FROM jsonb_array_elements(p_cells) AS c
    ),
    claimed AS (
        UPDATE squares s
        SET player_name = v_name, claimed_at = NOW()
        FROM requested r
        WHERE s.party_id = p_party_id
          AND s.row_num = r.row_num AND s.col_num = r.col_num
          AND s.player_name IS NULL
        RETURNING s.row_num, s.col_num
    )
    SELECT
        COALESCE((SELECT jsonb_agg(jsonb_build_object('row', row_num, 'col', col_num)) FROM claimed), '[]'),
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('row', r.row_num, 'col', r.col_num,
                                                'player_name', s.player_name))
            FROM requested r
            JOIN squares s ON s.party_id = p_party_id
                          AND s.row_num = r.row_num AND s.col_num = r.col_num
            WHERE NOT EXISTS (
                SELECT 1 FROM claimed c WHERE c.row_num = r.row_num AND c.col_num = r.col_num
            )
        ), '[]')
    INTO v_claimed, v_taken;

    RETURN jsonb_build_object('ok', true, 'claimed', v_claimed, 'taken', v_taken);
END;
$$;

GRANT EXECUTE ON FUNCTION claim_squares(UUID, VARCHAR, JSONB) TO anon, authenticated;
