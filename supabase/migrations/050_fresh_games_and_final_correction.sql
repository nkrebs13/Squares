-- 1. Only a game whose feed is still writing is detected for an unlinked party. Nothing
--    feeds game_scores any more (last write 2026-02-14), and rows left non-final (a test
--    row "Home Eagles" vs "Away Chiefs" in progress, a college game at halftime) were
--    detected forever: any Eagles/Chiefs party showed a frozen LIVE scoreboard. A game
--    not updated for 12 hours is not live, whatever its status says.
-- 2. The final score can be corrected after the game is complete (HB-2444): before,
--    the final set the party complete and every later score was refused, so a typo
--    paid the wrong square for good. Only the final, only by re-recording it.

CREATE OR REPLACE FUNCTION "public"."get_party_state"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_party parties;
    v_game game_scores;
    v_home_is_row BOOLEAN;
BEGIN
    SELECT * INTO v_party FROM parties WHERE code = upper(p_code);
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_party.game_id IS NOT NULL THEN
        SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
        v_home_is_row := v_party.home_team_is_row;
    ELSE
        SELECT * INTO v_game FROM game_scores g
        WHERE g.game_status <> 'final'
          AND g.updated_at > now() - interval '12 hours'
          AND game_side(v_party.team_row_name, v_party.team_col_name, g) IS NOT NULL
        ORDER BY g.updated_at DESC
        LIMIT 1;
        v_home_is_row := game_side(v_party.team_row_name, v_party.team_col_name, v_game);
    END IF;

    RETURN jsonb_build_object(
        'party', public_party_json(v_party),
        'squares', COALESCE((
            SELECT jsonb_agg(to_jsonb(s) ORDER BY s.row_num, s.col_num)
            FROM squares s WHERE s.party_id = v_party.id), '[]'),
        'numbers', (SELECT to_jsonb(n) FROM numbers n WHERE n.party_id = v_party.id),
        'scores', (SELECT to_jsonb(sc) FROM scores sc WHERE sc.party_id = v_party.id),
        'winners', COALESCE((
            SELECT jsonb_agg(to_jsonb(w) ORDER BY w.quarter)
            FROM winners w WHERE w.party_id = v_party.id), '[]'),
        'game', CASE WHEN v_game.game_id IS NULL THEN NULL ELSE jsonb_build_object(
            'row', to_jsonb(v_game),
            'home_is_row', COALESCE(v_home_is_row, TRUE),
            'linked', v_party.game_id IS NOT NULL
        ) END
    );
END;
$$;


CREATE OR REPLACE FUNCTION "public"."record_quarter_score"("p_party_id" "uuid", "p_quarter" "text", "p_row_score" integer, "p_col_score" integer) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
    v_party parties;
    v_winning_row INT;
    v_winning_col INT;
    v_winner_name TEXT;
BEGIN
    SELECT * INTO v_party FROM parties WHERE id = p_party_id FOR UPDATE;
    -- A complete party takes one more score: a corrected final (the host typed it
    -- wrong). The winners upsert below re-picks the final winner; status stays complete.
    IF NOT FOUND OR NOT (v_party.status IN ('active', 'locked')
                         OR (v_party.status = 'complete' AND p_quarter = 'final')) THEN
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
$_$;


-- updated_at was only set on insert. The freshness check above reads it, so every
-- update now stamps it, whatever the feeder sends.
CREATE OR REPLACE FUNCTION public.touch_game_scores_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER game_scores_touch_updated_at
    BEFORE UPDATE ON public.game_scores
    FOR EACH ROW EXECUTE FUNCTION public.touch_game_scores_updated_at();
