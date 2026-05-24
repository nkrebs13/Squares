-- 028: Route party mutations through explicit RPCs.
--
-- The original schema allowed any anon client to UPDATE any row in parties.
-- That was convenient while early host actions were being prototyped, but it
-- leaves host-owned settings such as payout splits and game mapping writable
-- without a PIN. Keep public reads, but make party writes go through RPCs that
-- either verify the host PIN or derive the value server-side.

CREATE OR REPLACE FUNCTION update_payout_structure(
  p_party_id UUID,
  p_pin VARCHAR(4),
  p_split_q1 INTEGER,
  p_split_q2 INTEGER,
  p_split_q3 INTEGER,
  p_split_final INTEGER
)
RETURNS parties
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_party parties;
  v_pin_ok BOOLEAN;
BEGIN
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    RAISE EXCEPTION 'invalid party or PIN'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'party not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_party.status != 'filling' THEN
    RAISE EXCEPTION 'payout structure can only be changed before the grid is locked'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_split_q1 IS NULL OR p_split_q2 IS NULL
     OR p_split_q3 IS NULL OR p_split_final IS NULL THEN
    RAISE EXCEPTION 'all split values must be provided'
      USING ERRCODE = 'not_null_violation';
  END IF;

  IF p_split_q1 < 0 OR p_split_q1 > 100
     OR p_split_q2 < 0 OR p_split_q2 > 100
     OR p_split_q3 < 0 OR p_split_q3 > 100
     OR p_split_final < 0 OR p_split_final > 100 THEN
    RAISE EXCEPTION 'each split must be between 0 and 100'
      USING ERRCODE = 'check_violation';
  END IF;

  IF (p_split_q1 + p_split_q2 + p_split_q3 + p_split_final) != 100 THEN
    RAISE EXCEPTION 'splits must sum to exactly 100 (got %)',
      p_split_q1 + p_split_q2 + p_split_q3 + p_split_final
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE parties
  SET
    split_q1 = p_split_q1,
    split_q2 = p_split_q2,
    split_q3 = p_split_q3,
    split_final = p_split_final
  WHERE id = p_party_id
  RETURNING * INTO v_party;

  RETURN v_party;
END;
$$;

CREATE OR REPLACE FUNCTION sync_party_home_team_mapping(p_party_id UUID)
RETURNS parties
LANGUAGE plpgsql
SECURITY DEFINER
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
  IF NOT FOUND OR v_party.game_id IS NULL THEN
    RETURN v_party;
  END IF;

  SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
  IF NOT FOUND THEN
    RETURN v_party;
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
    RETURN v_party;
  END IF;

  IF v_home_is_row IS DISTINCT FROM v_party.home_team_is_row THEN
    UPDATE parties
    SET home_team_is_row = v_home_is_row
    WHERE id = p_party_id
    RETURNING * INTO v_party;
  END IF;

  RETURN v_party;
END;
$$;

REVOKE ALL ON FUNCTION update_payout_structure(
  UUID, VARCHAR(4), INTEGER, INTEGER, INTEGER, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_payout_structure(
  UUID, VARCHAR(4), INTEGER, INTEGER, INTEGER, INTEGER
) TO anon, authenticated;

REVOKE ALL ON FUNCTION sync_party_home_team_mapping(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION sync_party_home_team_mapping(UUID) TO anon, authenticated;

DROP POLICY IF EXISTS "Host can update own party" ON parties;
