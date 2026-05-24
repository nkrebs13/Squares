-- 029: Route game-domain writes through RPCs.
--
-- The original schema allowed anon clients to write directly to the core game
-- tables. Public reads are intentional for no-account sharing, but mutations
-- should flow through RPCs where status, ownership, and host PIN rules are
-- enforced consistently.

CREATE OR REPLACE FUNCTION public_party_json(p_party parties)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
    SELECT to_jsonb(p_party) - 'host_pin' - 'pin_attempts' - 'pin_locked_until';
$$;

CREATE OR REPLACE FUNCTION claim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_rows_affected INTEGER;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    UPDATE squares
    SET player_name = v_trimmed_name, claimed_at = NOW()
    WHERE party_id = p_party_id
      AND row_num = p_row
      AND col_num = p_col
      AND player_name IS NULL;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION unclaim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_rows_affected INTEGER;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    UPDATE squares
    SET player_name = NULL, claimed_at = NULL
    WHERE party_id = p_party_id
      AND row_num = p_row
      AND col_num = p_col
      AND LOWER(player_name) = LOWER(v_trimmed_name);

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$;

CREATE OR REPLACE FUNCTION claim_squares_batch(
    p_party_id UUID,
    p_player_name VARCHAR(50),
    p_cells JSONB
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_claimed_count INTEGER := 0;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN 0;
    END IF;

    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN 0;
    END IF;

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
$$;

CREATE OR REPLACE FUNCTION remove_player(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_player_name_lower VARCHAR(50)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_party parties;
    v_pin_ok BOOLEAN;
    v_removed_count INTEGER := 0;
    v_player_name_lower VARCHAR(50);
BEGIN
    v_pin_ok := check_pin_lockout(p_party_id, p_pin);
    IF NOT v_pin_ok THEN
        PERFORM log_audit_event('remove_player_failed', p_party_id,
            jsonb_build_object('reason', 'invalid_pin_or_lockout'));
        RAISE EXCEPTION 'invalid party or PIN'
          USING ERRCODE = 'invalid_authorization_specification';
    END IF;

    SELECT * INTO v_party FROM parties WHERE id = p_party_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'party not found'
          USING ERRCODE = 'no_data_found';
    END IF;

    IF v_party.status != 'filling' THEN
        RAISE EXCEPTION 'players can only be removed before the grid is locked'
          USING ERRCODE = 'check_violation';
    END IF;

    v_player_name_lower := lower(TRIM(p_player_name_lower));
    IF v_player_name_lower IS NULL OR v_player_name_lower = '' THEN
        RAISE EXCEPTION 'player name must be provided'
          USING ERRCODE = 'check_violation';
    END IF;

    UPDATE squares
    SET player_name = NULL, claimed_at = NULL
    WHERE party_id = p_party_id
      AND player_name_lower = v_player_name_lower;

    GET DIAGNOSTICS v_removed_count = ROW_COUNT;

    PERFORM log_audit_event('remove_player_success', p_party_id,
        jsonb_build_object('player_name_lower', v_player_name_lower, 'removed_count', v_removed_count));

    RETURN v_removed_count;
END;
$$;

REVOKE ALL ON FUNCTION claim_square(UUID, INTEGER, INTEGER, VARCHAR(50)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_square(UUID, INTEGER, INTEGER, VARCHAR(50)) TO anon, authenticated;

REVOKE ALL ON FUNCTION unclaim_square(UUID, INTEGER, INTEGER, VARCHAR(50)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION unclaim_square(UUID, INTEGER, INTEGER, VARCHAR(50)) TO anon, authenticated;

REVOKE ALL ON FUNCTION claim_squares_batch(UUID, VARCHAR(50), JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION claim_squares_batch(UUID, VARCHAR(50), JSONB) TO anon, authenticated;

REVOKE ALL ON FUNCTION remove_player(UUID, VARCHAR(4), VARCHAR(50)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_player(UUID, VARCHAR(4), VARCHAR(50)) TO anon, authenticated;

DROP FUNCTION IF EXISTS sync_party_home_team_mapping(UUID);
CREATE FUNCTION sync_party_home_team_mapping(p_party_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_party parties;
  v_game game_scores;
  v_row_name TEXT;
  v_col_name TEXT;
  v_home_name TEXT;
  v_away_name TEXT;
  v_home_abbrev TEXT;
  v_away_abbrev TEXT;
  v_row_name_esc TEXT;
  v_col_name_esc TEXT;
  v_home_name_esc TEXT;
  v_away_name_esc TEXT;
  v_row_home BOOLEAN;
  v_row_away BOOLEAN;
  v_col_home BOOLEAN;
  v_col_away BOOLEAN;
  v_home_is_row BOOLEAN;
BEGIN
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'party not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_party.game_id IS NULL THEN
    RETURN public_party_json(v_party);
  END IF;

  SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
  IF NOT FOUND THEN
    RETURN public_party_json(v_party);
  END IF;

  v_row_name := lower(v_party.team_row_name);
  v_col_name := lower(v_party.team_col_name);
  v_home_name := lower(v_game.home_team_name);
  v_away_name := lower(v_game.away_team_name);
  v_home_abbrev := lower(v_game.home_team_abbrev);
  v_away_abbrev := lower(v_game.away_team_abbrev);
  v_row_name_esc := replace(replace(replace(v_row_name, '\', '\\'), '%', '\%'), '_', '\_');
  v_col_name_esc := replace(replace(replace(v_col_name, '\', '\\'), '%', '\%'), '_', '\_');
  v_home_name_esc := replace(replace(replace(v_home_name, '\', '\\'), '%', '\%'), '_', '\_');
  v_away_name_esc := replace(replace(replace(v_away_name, '\', '\\'), '%', '\%'), '_', '\_');

  v_row_home := v_home_name LIKE '%' || v_row_name_esc || '%' ESCAPE '\'
    OR v_row_name LIKE '%' || v_home_name_esc || '%' ESCAPE '\'
    OR v_home_abbrev = v_row_name;
  v_row_away := v_away_name LIKE '%' || v_row_name_esc || '%' ESCAPE '\'
    OR v_row_name LIKE '%' || v_away_name_esc || '%' ESCAPE '\'
    OR v_away_abbrev = v_row_name;
  v_col_home := v_home_name LIKE '%' || v_col_name_esc || '%' ESCAPE '\'
    OR v_col_name LIKE '%' || v_home_name_esc || '%' ESCAPE '\'
    OR v_home_abbrev = v_col_name;
  v_col_away := v_away_name LIKE '%' || v_col_name_esc || '%' ESCAPE '\'
    OR v_col_name LIKE '%' || v_away_name_esc || '%' ESCAPE '\'
    OR v_away_abbrev = v_col_name;

  IF v_row_home AND v_col_away THEN
    v_home_is_row := TRUE;
  ELSIF v_row_away AND v_col_home THEN
    v_home_is_row := FALSE;
  ELSE
    RETURN public_party_json(v_party);
  END IF;

  IF v_home_is_row IS DISTINCT FROM v_party.home_team_is_row THEN
    UPDATE parties
    SET home_team_is_row = v_home_is_row
    WHERE id = p_party_id
    RETURNING * INTO v_party;
  END IF;

  RETURN public_party_json(v_party);
END;
$$;

REVOKE ALL ON FUNCTION sync_party_home_team_mapping(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_party_home_team_mapping(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Anyone can create parties" ON parties;

DROP POLICY IF EXISTS "Anyone can create squares" ON squares;
DROP POLICY IF EXISTS "Anyone can update squares" ON squares;

DROP POLICY IF EXISTS "Anyone can create numbers" ON numbers;

DROP POLICY IF EXISTS "Anyone can create scores" ON scores;
DROP POLICY IF EXISTS "Anyone can update scores" ON scores;

DROP POLICY IF EXISTS "Anyone can create winners" ON winners;

DROP POLICY IF EXISTS "Anyone can update heartbeat" ON heartbeat;

REVOKE INSERT, UPDATE, DELETE ON parties FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON squares FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON numbers FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON scores FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON winners FROM anon, authenticated;
REVOKE UPDATE ON heartbeat FROM anon, authenticated;

REVOKE SELECT ON parties FROM anon, authenticated;
GRANT SELECT (
  id,
  code,
  host_name_lower,
  event_name,
  kickoff_at,
  square_price,
  split_q1,
  split_q2,
  split_q3,
  split_final,
  status,
  team_row_name,
  team_col_name,
  team_row_color,
  team_col_color,
  created_at,
  updated_at,
  expires_at,
  game_id,
  home_team_is_row
) ON parties TO anon, authenticated;
