-- Party details on the host_* contract (see 035).
--
-- create_party and update_party_details each carried a copy of the same
-- validation and expiry rule, RAISEd prose the client had to regex-match, and
-- defaulted missing teams/event to hardcoded brand values that bypassed the
-- client's env-configured APP_CONFIG. host_create_party and host_update_details
-- share one validator, return {ok, error, field}, and take every value from the
-- caller.

-- NULL when the details are valid, else the field to report:
-- event_name, team_name, teams (same team twice) or team_color.
CREATE FUNCTION party_details_problem(
    p_event_name TEXT,
    p_team_row_name TEXT,
    p_team_col_name TEXT,
    p_team_row_color TEXT,
    p_team_col_color TEXT
) RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN COALESCE(TRIM(p_event_name), '') = '' OR length(TRIM(p_event_name)) > 80 THEN 'event_name'
        WHEN COALESCE(TRIM(p_team_row_name), '') = '' OR COALESCE(TRIM(p_team_col_name), '') = ''
             OR length(TRIM(p_team_row_name)) > 50 OR length(TRIM(p_team_col_name)) > 50 THEN 'team_name'
        WHEN lower(regexp_replace(TRIM(p_team_row_name), '\s+', ' ', 'g'))
           = lower(regexp_replace(TRIM(p_team_col_name), '\s+', ' ', 'g')) THEN 'teams'
        WHEN p_team_row_color IS NULL OR p_team_col_color IS NULL
             OR p_team_row_color !~ '^#[0-9A-Fa-f]{6}$'
             OR p_team_col_color !~ '^#[0-9A-Fa-f]{6}$' THEN 'team_color'
    END;
$$;

-- The same rule as the parties split CHECKs, as a predicate.
CREATE FUNCTION splits_valid(p_q1 INT, p_q2 INT, p_q3 INT, p_final INT) RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT p_q1 IS NOT NULL AND p_q2 IS NOT NULL AND p_q3 IS NOT NULL AND p_final IS NOT NULL
       AND LEAST(p_q1, p_q2, p_q3, p_final) >= 0
       AND GREATEST(p_q1, p_q2, p_q3, p_final) <= 100
       AND p_q1 + p_q2 + p_q3 + p_final = 100;
$$;

-- A party is kept at least 30 days, and at least two weeks past kickoff.
CREATE FUNCTION party_expiry(p_kickoff_at TIMESTAMPTZ) RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
AS $$
    SELECT GREATEST(NOW() + INTERVAL '30 days', COALESCE(p_kickoff_at + INTERVAL '14 days', NOW()));
$$;

CREATE FUNCTION host_create_party(
    p_host_name VARCHAR(50),
    p_pin VARCHAR(4),
    p_square_price DECIMAL,
    p_split_q1 INT,
    p_split_q2 INT,
    p_split_q3 INT,
    p_split_final INT,
    p_team_row_name VARCHAR(50),
    p_team_col_name VARCHAR(50),
    p_team_row_color VARCHAR(7),
    p_team_col_color VARCHAR(7),
    p_event_name VARCHAR(80),
    p_kickoff_at TIMESTAMPTZ
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    -- No I, O, 0 or 1: codes are read aloud and typed.
    v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    v_problem TEXT;
    v_bytes BYTEA;
    v_code TEXT;
    v_party parties;
BEGIN
    IF COALESCE(TRIM(p_host_name), '') = '' OR length(TRIM(p_host_name)) > 50 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'host_name');
    END IF;
    IF p_pin IS NULL OR p_pin !~ '^\d{4}$' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'pin');
    END IF;
    IF p_square_price IS NULL OR p_square_price <= 0 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'square_price');
    END IF;
    IF NOT splits_valid(p_split_q1, p_split_q2, p_split_q3, p_split_final) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'splits');
    END IF;
    v_problem := party_details_problem(p_event_name, p_team_row_name, p_team_col_name,
                                       p_team_row_color, p_team_col_color);
    IF v_problem IS NOT NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', v_problem);
    END IF;

    -- 32^6 codes: a collision is rare, five in a row means something is wrong.
    FOR v_attempt IN 1..5 LOOP
        v_bytes := gen_random_bytes(6);
        v_code := '';
        FOR i IN 0..5 LOOP
            v_code := v_code || substr(v_alphabet, get_byte(v_bytes, i) % 32 + 1, 1);
        END LOOP;

        BEGIN
            INSERT INTO parties (
                code, host_pin, host_name_lower, event_name, kickoff_at, square_price,
                split_q1, split_q2, split_q3, split_final,
                team_row_name, team_col_name, team_row_color, team_col_color, expires_at
            ) VALUES (
                v_code, p_pin, LOWER(TRIM(p_host_name)), TRIM(p_event_name), p_kickoff_at, p_square_price,
                p_split_q1, p_split_q2, p_split_q3, p_split_final,
                TRIM(p_team_row_name), TRIM(p_team_col_name), p_team_row_color, p_team_col_color,
                party_expiry(p_kickoff_at)
            )
            RETURNING * INTO v_party;
            EXIT;
        EXCEPTION WHEN unique_violation THEN
            IF v_attempt = 5 THEN
                RAISE;
            END IF;
        END;
    END LOOP;

    INSERT INTO squares (party_id, row_num, col_num)
    SELECT v_party.id, r, c FROM generate_series(0, 9) AS r CROSS JOIN generate_series(0, 9) AS c;
    INSERT INTO scores (party_id) VALUES (v_party.id);

    RETURN jsonb_build_object('ok', true, 'party', public_party_json(v_party));
END;
$$;

CREATE FUNCTION host_update_details(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_event_name VARCHAR(80),
    p_kickoff_at TIMESTAMPTZ,
    p_team_row_name VARCHAR(50),
    p_team_col_name VARCHAR(50),
    p_team_row_color VARCHAR(7),
    p_team_col_color VARCHAR(7)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_refusal JSONB;
    v_problem TEXT;
    v_party parties;
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'update_details', 'filling');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    v_problem := party_details_problem(p_event_name, p_team_row_name, p_team_col_name,
                                       p_team_row_color, p_team_col_color);
    IF v_problem IS NOT NULL THEN
        RETURN host_refusal(p_party_id, 'update_details', 'invalid_input', v_problem);
    END IF;

    UPDATE parties
    SET event_name = TRIM(p_event_name),
        kickoff_at = p_kickoff_at,
        team_row_name = TRIM(p_team_row_name),
        team_col_name = TRIM(p_team_col_name),
        team_row_color = p_team_row_color,
        team_col_color = p_team_col_color,
        expires_at = party_expiry(p_kickoff_at)
    WHERE id = p_party_id
    RETURNING * INTO v_party;

    PERFORM log_audit_event('update_details_success', p_party_id, NULL);
    RETURN jsonb_build_object('ok', true, 'party', public_party_json(v_party));
END;
$$;

-- host_update_payouts (035) uses the shared split rule too.
CREATE OR REPLACE FUNCTION host_update_payouts(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_split_q1 INT,
    p_split_q2 INT,
    p_split_q3 INT,
    p_split_final INT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_refusal JSONB;
    v_party parties;
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'update_payouts', 'filling');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    IF NOT splits_valid(p_split_q1, p_split_q2, p_split_q3, p_split_final) THEN
        RETURN host_refusal(p_party_id, 'update_payouts', 'invalid_input', 'splits');
    END IF;

    UPDATE parties
    SET split_q1 = p_split_q1, split_q2 = p_split_q2,
        split_q3 = p_split_q3, split_final = p_split_final
    WHERE id = p_party_id
    RETURNING * INTO v_party;

    PERFORM log_audit_event('update_payouts_success', p_party_id, NULL);
    RETURN jsonb_build_object('ok', true, 'party', public_party_json(v_party));
END;
$$;

GRANT EXECUTE ON FUNCTION host_create_party(VARCHAR, VARCHAR, DECIMAL, INT, INT, INT, INT, VARCHAR, VARCHAR, VARCHAR, VARCHAR, VARCHAR, TIMESTAMPTZ) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_update_details(UUID, VARCHAR, VARCHAR, TIMESTAMPTZ, VARCHAR, VARCHAR, VARCHAR, VARCHAR) TO anon, authenticated;
