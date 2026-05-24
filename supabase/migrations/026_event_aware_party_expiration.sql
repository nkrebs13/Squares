-- 026: Keep future-game pools alive through the event.
--
-- The base schema's 30-day expiration is fine for ad hoc pools, but it breaks
-- the future-game use case: a host can create "2027 Super Bowl" months in
-- advance and expect the shared link to still work on game day. When kickoff is
-- known, expire the party two weeks after kickoff; otherwise keep the existing
-- 30-day cleanup window.

UPDATE parties
SET expires_at = GREATEST(expires_at, kickoff_at + INTERVAL '14 days')
WHERE kickoff_at IS NOT NULL;

CREATE OR REPLACE FUNCTION create_party(
  p_host_name VARCHAR(50),
  p_pin VARCHAR(4),
  p_square_price DECIMAL(10, 2),
  p_split_q1 INTEGER,
  p_split_q2 INTEGER,
  p_split_q3 INTEGER,
  p_split_final INTEGER,
  p_team_row_name VARCHAR(50) DEFAULT 'Seahawks',
  p_team_col_name VARCHAR(50) DEFAULT 'Patriots',
  p_team_row_color VARCHAR(7) DEFAULT '#69BE28',
  p_team_col_color VARCHAR(7) DEFAULT '#C60C30',
  p_event_name VARCHAR(80) DEFAULT 'Football Squares',
  p_kickoff_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS parties
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_alphabet_len CONSTANT INT := length(v_alphabet);
  v_code VARCHAR(6);
  v_attempt INT;
  v_party parties;
  v_trimmed_host VARCHAR(50);
  v_trimmed_event VARCHAR(80);
  v_random_bytes BYTEA;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_trimmed_host := TRIM(p_host_name);
  IF v_trimmed_host IS NULL OR length(v_trimmed_host) = 0 THEN
    RAISE EXCEPTION 'host_name must be non-empty after trim'
      USING ERRCODE = 'check_violation';
  END IF;
  IF length(v_trimmed_host) > 50 THEN
    RAISE EXCEPTION 'host_name must be at most 50 characters'
      USING ERRCODE = 'string_data_right_truncation';
  END IF;

  v_trimmed_event := COALESCE(NULLIF(TRIM(p_event_name), ''), 'Football Squares');
  IF length(v_trimmed_event) > 80 THEN
    RAISE EXCEPTION 'event_name must be at most 80 characters'
      USING ERRCODE = 'string_data_right_truncation';
  END IF;

  IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'PIN must be exactly 4 digits'
      USING ERRCODE = 'invalid_text_representation';
  END IF;

  IF p_square_price IS NULL OR p_square_price <= 0 THEN
    RAISE EXCEPTION 'square_price must be greater than 0'
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

  v_expires_at := GREATEST(
    NOW() + INTERVAL '30 days',
    COALESCE(p_kickoff_at + INTERVAL '14 days', NOW() + INTERVAL '30 days')
  );

  FOR v_attempt IN 1..5 LOOP
    v_random_bytes := gen_random_bytes(6);
    v_code :=
      substr(v_alphabet, (get_byte(v_random_bytes, 0) % v_alphabet_len) + 1, 1) ||
      substr(v_alphabet, (get_byte(v_random_bytes, 1) % v_alphabet_len) + 1, 1) ||
      substr(v_alphabet, (get_byte(v_random_bytes, 2) % v_alphabet_len) + 1, 1) ||
      substr(v_alphabet, (get_byte(v_random_bytes, 3) % v_alphabet_len) + 1, 1) ||
      substr(v_alphabet, (get_byte(v_random_bytes, 4) % v_alphabet_len) + 1, 1) ||
      substr(v_alphabet, (get_byte(v_random_bytes, 5) % v_alphabet_len) + 1, 1);

    BEGIN
      INSERT INTO parties (
        code, host_pin, host_name_lower,
        event_name, kickoff_at,
        square_price,
        split_q1, split_q2, split_q3, split_final,
        status,
        team_row_name, team_col_name,
        team_row_color, team_col_color,
        expires_at
      )
      VALUES (
        v_code, p_pin, LOWER(v_trimmed_host),
        v_trimmed_event, p_kickoff_at,
        p_square_price,
        p_split_q1, p_split_q2, p_split_q3, p_split_final,
        'filling',
        p_team_row_name, p_team_col_name,
        p_team_row_color, p_team_col_color,
        v_expires_at
      )
      RETURNING * INTO v_party;

      EXIT;

    EXCEPTION
      WHEN unique_violation THEN
        IF v_attempt = 5 THEN
          RAISE EXCEPTION 'failed to generate unique party code after 5 attempts'
            USING ERRCODE = 'unique_violation';
        END IF;
    END;
  END LOOP;

  INSERT INTO squares (party_id, row_num, col_num)
  SELECT v_party.id, r, c
  FROM generate_series(0, 9) AS r
  CROSS JOIN generate_series(0, 9) AS c;

  INSERT INTO scores (party_id) VALUES (v_party.id);

  RETURN v_party;
END;
$$;

REVOKE ALL ON FUNCTION create_party(
  VARCHAR(50), VARCHAR(4), DECIMAL,
  INTEGER, INTEGER, INTEGER, INTEGER,
  VARCHAR(50), VARCHAR(50), VARCHAR(7), VARCHAR(7),
  VARCHAR(80), TIMESTAMPTZ
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION create_party(
  VARCHAR(50), VARCHAR(4), DECIMAL,
  INTEGER, INTEGER, INTEGER, INTEGER,
  VARCHAR(50), VARCHAR(50), VARCHAR(7), VARCHAR(7),
  VARCHAR(80), TIMESTAMPTZ
) TO anon, authenticated;
