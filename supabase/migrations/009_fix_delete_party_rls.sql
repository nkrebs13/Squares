-- Fix delete_party: add SECURITY DEFINER so DELETE bypasses RLS.
-- The parties table has no DELETE RLS policy, so the previous SECURITY INVOKER
-- version silently deleted 0 rows. The function already validates the host PIN
-- before deleting, so SECURITY DEFINER is safe here.

CREATE OR REPLACE FUNCTION delete_party(
    p_party_id UUID,
    p_pin VARCHAR(4)
)
RETURNS BOOLEAN AS $$
DECLARE
    v_host_pin VARCHAR(4);
    v_code VARCHAR(6);
BEGIN
    SELECT host_pin, code INTO v_host_pin, v_code
    FROM parties WHERE id = p_party_id;

    IF v_host_pin IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_host_pin != p_pin THEN
        PERFORM log_audit_event('delete_party_failed', p_party_id,
            jsonb_build_object('reason', 'invalid_pin'));
        RETURN FALSE;
    END IF;

    -- Log before delete (since party_id will be gone after)
    PERFORM log_audit_event('delete_party_success', NULL,
        jsonb_build_object('deleted_party_id', p_party_id, 'code', v_code));

    DELETE FROM parties WHERE id = p_party_id;

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
