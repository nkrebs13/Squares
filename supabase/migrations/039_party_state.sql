-- One read for a party's state, and one owner for the team ↔ game mapping.
--
-- loadParty ran six ordered queries (with the party column list kept in four
-- places), ignored four of their errors, auto-detected a live game client-side
-- with an unordered LIMIT 10, and on every load fired sync_party_home_team_mapping,
-- a write. The team matching rule existed three times (two TS matchers + SQL).
--
-- get_party_state returns everything a party page needs in one call. game_side
-- is the only matching rule. A trigger keeps parties.home_team_is_row right
-- whenever the game link or team names change, so nothing writes on read.

-- TRUE when the game's home team is the party's row team, FALSE when it is the
-- column team, NULL when the game is not this matchup. A party team matches a
-- game team when either name contains the other, or it equals the abbreviation.
CREATE FUNCTION game_side(p_row_name TEXT, p_col_name TEXT, p_game game_scores) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    WITH n AS (
        SELECT lower(p_row_name) AS r, lower(p_col_name) AS c,
               lower(p_game.home_team_name) AS hn, lower(p_game.home_team_abbrev) AS ha,
               lower(p_game.away_team_name) AS an, lower(p_game.away_team_abbrev) AS aa
    ),
    m AS (
        SELECT (strpos(hn, r) > 0 OR strpos(r, hn) > 0 OR ha = r) AS row_home,
               (strpos(an, r) > 0 OR strpos(r, an) > 0 OR aa = r) AS row_away,
               (strpos(hn, c) > 0 OR strpos(c, hn) > 0 OR ha = c) AS col_home,
               (strpos(an, c) > 0 OR strpos(c, an) > 0 OR aa = c) AS col_away
        FROM n
    )
    SELECT CASE
        WHEN row_home AND col_away THEN TRUE
        WHEN row_away AND col_home THEN FALSE
    END
    FROM m;
$$;

CREATE FUNCTION set_home_team_side() RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_side BOOLEAN;
BEGIN
    IF NEW.game_id IS NOT NULL THEN
        SELECT game_side(NEW.team_row_name, NEW.team_col_name, g) INTO v_side
        FROM game_scores g WHERE g.game_id = NEW.game_id;
        NEW.home_team_is_row := COALESCE(v_side, NEW.home_team_is_row);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER parties_home_team_side
    BEFORE INSERT OR UPDATE OF game_id, team_row_name, team_col_name ON parties
    FOR EACH ROW EXECUTE FUNCTION set_home_team_side();

-- Correct any linked party whose flag disagrees with the rule today.
UPDATE parties p
SET home_team_is_row = game_side(p.team_row_name, p.team_col_name, g)
FROM game_scores g
WHERE g.game_id = p.game_id
  AND game_side(p.team_row_name, p.team_col_name, g) IS DISTINCT FROM p.home_team_is_row
  AND game_side(p.team_row_name, p.team_col_name, g) IS NOT NULL;

-- Everything a party page loads, or NULL when the code matches no party.
-- `game` is the linked game, or else the most recently updated unfinished game
-- for this matchup (shown as live scores only: `linked` is false and nothing
-- is scored from it).
CREATE FUNCTION get_party_state(p_code TEXT) RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
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

GRANT EXECUTE ON FUNCTION get_party_state(TEXT) TO anon, authenticated;
