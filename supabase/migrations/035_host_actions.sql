-- Host actions: one PIN gate and one result shape.
--
-- Every PIN-gated action is a `host_*` function that returns
--   {"ok": true, ...}                       on success, or
--   {"ok": false, "error": <code>[, "field": <name>]}
-- with <code> one of:
--   not_found       the party does not exist
--   invalid_pin     wrong PIN (counts toward the lockout)
--   locked_out      too many wrong PINs; retry after the lockout window
--   wrong_status    the party is not in the status this action needs
--   grid_incomplete lock attempted before all squares are claimed
--   invalid_input   an argument failed validation; `field` names it
--
-- Refusals RETURN, never RAISE: PostgREST runs each call as one transaction,
-- so a RAISE would roll back the failed-attempt increment and reopen a
-- 10,000-PIN brute-force oracle (migration 033). RAISE is kept for integrity
-- faults that should roll the whole call back.
--
-- The old boolean / NULL-sentinel functions stay until the deployed client
-- no longer calls them, then a later migration drops them.

-- Parties created before migration 023 have no scores row. Give them one so
-- nothing has to special-case its absence.
INSERT INTO scores (party_id)
SELECT p.id FROM parties p
WHERE NOT EXISTS (SELECT 1 FROM scores s WHERE s.party_id = p.id);

-- Checks the PIN against the lockout window. Locks the party row FOR UPDATE,
-- so a caller's later status read cannot race another host action.
-- Returns 'ok', 'not_found', 'invalid_pin' or 'locked_out'.
CREATE FUNCTION host_pin_check(p_party_id UUID, p_pin VARCHAR(4)) RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_party RECORD;
BEGIN
    SELECT host_pin, pin_attempts, pin_locked_until INTO v_party
    FROM parties WHERE id = p_party_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN 'not_found';
    END IF;

    IF v_party.pin_locked_until > NOW() THEN
        RETURN 'locked_out';
    END IF;

    IF v_party.host_pin = p_pin THEN
        UPDATE parties SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_party_id;
        RETURN 'ok';
    END IF;

    -- An expired lockout starts a fresh window of attempts.
    UPDATE parties
    SET pin_attempts = CASE WHEN pin_locked_until IS NULL THEN pin_attempts + 1 ELSE 1 END,
        pin_locked_until = CASE
            WHEN (CASE WHEN pin_locked_until IS NULL THEN pin_attempts + 1 ELSE 1 END) >= 5
                THEN NOW() + INTERVAL '5 minutes'
            ELSE NULL
        END
    WHERE id = p_party_id;
    RETURN 'invalid_pin';
END;
$$;

-- A refusal result, audited.
CREATE FUNCTION host_refusal(
    p_party_id UUID,
    p_action TEXT,
    p_error TEXT,
    p_field TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF p_error <> 'not_found' THEN
        PERFORM log_audit_event(p_action || '_failed', p_party_id,
            jsonb_build_object('reason', p_error, 'field', p_field));
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object('ok', false, 'error', p_error, 'field', p_field));
END;
$$;

-- The gate every host action starts with: PIN + lockout, then (optionally)
-- the party status the action needs. NULL means the caller may proceed.
CREATE FUNCTION host_gate(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_action TEXT,
    p_required_status TEXT DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_check TEXT;
    v_status TEXT;
BEGIN
    v_check := host_pin_check(p_party_id, p_pin);
    IF v_check <> 'ok' THEN
        RETURN host_refusal(p_party_id, p_action, v_check);
    END IF;

    IF p_required_status IS NOT NULL THEN
        SELECT status INTO v_status FROM parties WHERE id = p_party_id;
        IF v_status <> p_required_status THEN
            RETURN host_refusal(p_party_id, p_action, 'wrong_status');
        END IF;
    END IF;

    RETURN NULL;
END;
$$;

CREATE FUNCTION host_verify_pin(p_party_code VARCHAR(6), p_pin VARCHAR(4)) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_party_id UUID;
    v_check TEXT;
BEGIN
    SELECT id INTO v_party_id FROM parties WHERE code = UPPER(p_party_code);
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;

    v_check := host_pin_check(v_party_id, p_pin);
    IF v_check <> 'ok' THEN
        RETURN jsonb_build_object('ok', false, 'error', v_check);
    END IF;
    RETURN jsonb_build_object('ok', true);
END;
$$;

-- Assigns the numbers and starts the game. Returns the updated party and numbers.
CREATE FUNCTION host_lock_party(p_party_id UUID, p_pin VARCHAR(4)) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_refusal JSONB;
    v_party parties;
    v_numbers numbers;
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'lock_party', 'filling');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    -- Lock all of the party's squares, not just the empty ones: a concurrent
    -- unclaim of a filled square must also wait for this transaction.
    PERFORM 1 FROM squares WHERE party_id = p_party_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM squares WHERE party_id = p_party_id AND player_name IS NULL) THEN
        RETURN host_refusal(p_party_id, 'lock_party', 'grid_incomplete');
    END IF;

    INSERT INTO numbers (party_id, row_numbers, col_numbers)
    VALUES (
        p_party_id,
        (SELECT array_agg(n ORDER BY random()) FROM generate_series(0, 9) AS n),
        (SELECT array_agg(n ORDER BY random()) FROM generate_series(0, 9) AS n)
    )
    RETURNING * INTO v_numbers;

    UPDATE parties SET status = 'active' WHERE id = p_party_id RETURNING * INTO v_party;

    PERFORM log_audit_event('lock_party_success', p_party_id, NULL);
    RETURN jsonb_build_object(
        'ok', true,
        'party', public_party_json(v_party),
        'numbers', to_jsonb(v_numbers)
    );
END;
$$;

CREATE FUNCTION host_delete_party(p_party_id UUID, p_pin VARCHAR(4)) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_refusal JSONB;
    v_code VARCHAR(6);
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'delete_party');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    DELETE FROM parties WHERE id = p_party_id RETURNING code INTO v_code;
    -- party_id would be nulled by the FK once the party is gone.
    PERFORM log_audit_event('delete_party_success', NULL,
        jsonb_build_object('deleted_party_id', p_party_id, 'code', v_code));
    RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE FUNCTION host_remove_player(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_player_name VARCHAR(50)
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_refusal JSONB;
    v_name_lower TEXT := LOWER(TRIM(p_player_name));
    v_removed INTEGER;
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'remove_player', 'filling');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    IF v_name_lower IS NULL OR v_name_lower = '' THEN
        RETURN host_refusal(p_party_id, 'remove_player', 'invalid_input', 'player_name');
    END IF;

    UPDATE squares
    SET player_name = NULL, claimed_at = NULL
    WHERE party_id = p_party_id AND player_name_lower = v_name_lower;
    GET DIAGNOSTICS v_removed = ROW_COUNT;

    PERFORM log_audit_event('remove_player_success', p_party_id,
        jsonb_build_object('player_name_lower', v_name_lower, 'removed_count', v_removed));
    RETURN jsonb_build_object('ok', true, 'removed', v_removed);
END;
$$;

CREATE FUNCTION host_update_payouts(
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

    -- Same rule as the parties split CHECKs, answered as a refusal instead of a RAISE.
    IF p_split_q1 IS NULL OR p_split_q2 IS NULL OR p_split_q3 IS NULL OR p_split_final IS NULL
       OR LEAST(p_split_q1, p_split_q2, p_split_q3, p_split_final) < 0
       OR p_split_q1 + p_split_q2 + p_split_q3 + p_split_final <> 100 THEN
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

GRANT EXECUTE ON FUNCTION host_verify_pin(VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_lock_party(UUID, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_delete_party(UUID, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_remove_player(UUID, VARCHAR, VARCHAR) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION host_update_payouts(UUID, VARCHAR, INT, INT, INT, INT) TO anon, authenticated;
