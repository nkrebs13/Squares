-- 047: Locking a linked party applies the quarters its game has already scored.
--
-- The live trigger scores a linked party only while it is active (or locked), and
-- only when a quarter's scores first arrive. A party still filling when its game
-- recorded a quarter was skipped, and locking it later (after kickoff) never caught
-- up: those quarters kept no winner unless the operator ran backfill_party_scores
-- or the host typed every score in again. host_lock_party now runs that backfill
-- once the party is active. It does nothing for an unlinked party or a game that
-- has scored nothing; a final already scored completes the party, so the party is
-- read again before it is returned. auto_update_score contains any one quarter's
-- failure, so the lock itself always commits.

CREATE OR REPLACE FUNCTION public.host_lock_party(p_party_id UUID, p_pin VARCHAR)
RETURNS JSONB
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

    UPDATE parties SET status = 'active' WHERE id = p_party_id;

    -- A game linked to this party may already have scored quarters.
    PERFORM backfill_party_scores(p_party_id);
    SELECT * INTO v_party FROM parties WHERE id = p_party_id;

    PERFORM log_audit_event('lock_party_success', p_party_id, NULL);
    RETURN jsonb_build_object(
        'ok', true,
        'party', public_party_json(v_party),
        'numbers', to_jsonb(v_numbers)
    );
END;
$$;
