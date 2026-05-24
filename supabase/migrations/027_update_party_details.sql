-- 027: Allow hosts to correct event details before the grid is locked.
--
-- Future-game pools are often created well before kickoff. Hosts need a safe
-- way to fix the event name, kickoff time, or team labels without recreating
-- the pool and losing claimed squares. Keep this scoped to the filling phase;
-- once numbers and scores matter, edits should not rewrite game identity.

CREATE OR REPLACE FUNCTION update_party_details(
  p_party_id UUID,
  p_pin VARCHAR(4),
  p_event_name VARCHAR(80),
  p_kickoff_at TIMESTAMPTZ DEFAULT NULL,
  p_team_row_name VARCHAR(50) DEFAULT 'Seahawks',
  p_team_col_name VARCHAR(50) DEFAULT 'Patriots',
  p_team_row_color VARCHAR(7) DEFAULT '#69BE28',
  p_team_col_color VARCHAR(7) DEFAULT '#C60C30'
)
RETURNS parties
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_party parties;
  v_trimmed_event VARCHAR(80);
  v_trimmed_row_name VARCHAR(50);
  v_trimmed_col_name VARCHAR(50);
  v_expires_at TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_party
  FROM parties
  WHERE id = p_party_id
    AND host_pin = p_pin;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid party or PIN'
      USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  IF v_party.status != 'filling' THEN
    RAISE EXCEPTION 'party details can only be changed before the grid is locked'
      USING ERRCODE = 'check_violation';
  END IF;

  v_trimmed_event := COALESCE(NULLIF(TRIM(p_event_name), ''), 'Football Squares');
  IF length(v_trimmed_event) > 80 THEN
    RAISE EXCEPTION 'event_name must be at most 80 characters'
      USING ERRCODE = 'string_data_right_truncation';
  END IF;

  v_trimmed_row_name := TRIM(p_team_row_name);
  v_trimmed_col_name := TRIM(p_team_col_name);
  IF v_trimmed_row_name IS NULL OR length(v_trimmed_row_name) = 0 THEN
    RAISE EXCEPTION 'team_row_name must be non-empty after trim'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_trimmed_col_name IS NULL OR length(v_trimmed_col_name) = 0 THEN
    RAISE EXCEPTION 'team_col_name must be non-empty after trim'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_team_row_color !~ '^#[0-9A-Fa-f]{6}$'
     OR p_team_col_color !~ '^#[0-9A-Fa-f]{6}$' THEN
    RAISE EXCEPTION 'team colors must be 6-digit hex values'
      USING ERRCODE = 'check_violation';
  END IF;

  v_expires_at := GREATEST(
    NOW() + INTERVAL '30 days',
    COALESCE(p_kickoff_at + INTERVAL '14 days', NOW() + INTERVAL '30 days')
  );

  UPDATE parties
  SET
    event_name = v_trimmed_event,
    kickoff_at = p_kickoff_at,
    team_row_name = v_trimmed_row_name,
    team_col_name = v_trimmed_col_name,
    team_row_color = p_team_row_color,
    team_col_color = p_team_col_color,
    expires_at = v_expires_at
  WHERE id = p_party_id
  RETURNING * INTO v_party;

  RETURN v_party;
END;
$$;

REVOKE ALL ON FUNCTION update_party_details(
  UUID, VARCHAR(4), VARCHAR(80), TIMESTAMPTZ,
  VARCHAR(50), VARCHAR(50), VARCHAR(7), VARCHAR(7)
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION update_party_details(
  UUID, VARCHAR(4), VARCHAR(80), TIMESTAMPTZ,
  VARCHAR(50), VARCHAR(50), VARCHAR(7), VARCHAR(7)
) TO anon, authenticated;
