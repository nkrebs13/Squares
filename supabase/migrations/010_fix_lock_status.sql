-- Fix lock_party status regression
-- Production DB still has migration 002's version which sets status = 'locked'
-- instead of 'active'. This migration fixes stuck parties and ensures the
-- lock_party function sets status to 'active' with audit logging.

-- ============================================================================
-- FIX 1: Update any parties stuck in 'locked' status to 'active'
-- ============================================================================

UPDATE parties SET status = 'active' WHERE status = 'locked';

-- ============================================================================
-- FIX 2: Re-create lock_party with audit logging (from migration 007)
-- Ensures status is set to 'active', not 'locked'
-- ============================================================================

CREATE OR REPLACE FUNCTION lock_party(
    p_party_id UUID,
    p_pin VARCHAR(4)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_host_pin VARCHAR(4);
    v_filled_count INTEGER;
    v_row_nums INTEGER[];
    v_col_nums INTEGER[];
    v_success BOOLEAN;
BEGIN
    SELECT status, host_pin INTO v_party_status, v_host_pin
    FROM parties WHERE id = p_party_id;

    IF v_host_pin != p_pin THEN
        -- Log failed PIN attempt
        PERFORM log_audit_event('lock_party_failed', p_party_id,
            jsonb_build_object('reason', 'invalid_pin'));
        RETURN FALSE;
    END IF;

    IF v_party_status != 'filling' THEN
        PERFORM log_audit_event('lock_party_failed', p_party_id,
            jsonb_build_object('reason', 'invalid_status', 'status', v_party_status));
        RETURN FALSE;
    END IF;

    SELECT COUNT(*) INTO v_filled_count
    FROM squares
    WHERE party_id = p_party_id AND player_name IS NOT NULL;

    IF v_filled_count != 100 THEN
        PERFORM log_audit_event('lock_party_failed', p_party_id,
            jsonb_build_object('reason', 'incomplete_grid', 'filled', v_filled_count));
        RETURN FALSE;
    END IF;

    SELECT array_agg(n ORDER BY random()) INTO v_row_nums
    FROM generate_series(0, 9) AS n;

    SELECT array_agg(n ORDER BY random()) INTO v_col_nums
    FROM generate_series(0, 9) AS n;

    INSERT INTO numbers (party_id, row_numbers, col_numbers)
    VALUES (p_party_id, v_row_nums, v_col_nums);

    -- Set directly to 'active' - lock and start in one action
    UPDATE parties
    SET status = 'active'
    WHERE id = p_party_id;

    INSERT INTO scores (party_id)
    VALUES (p_party_id)
    ON CONFLICT (party_id) DO NOTHING;

    -- Log successful lock
    PERFORM log_audit_event('lock_party_success', p_party_id, NULL);

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
