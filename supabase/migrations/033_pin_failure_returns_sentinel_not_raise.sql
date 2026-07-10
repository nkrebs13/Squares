-- 033: Make PIN/lockout failure DURABLY throttle across ALL host-PIN RPCs by
-- returning a sentinel instead of RAISE. This SUPERSEDES the "KNOWN FOLLOW-UP
-- LIMITATION" documented in migration 032's header -- that limitation is now
-- FIXED here, not deferred.
--
-- THE MECHANISM (why 032's rerouting through check_pin_lockout was not enough):
-- check_pin_lockout() (migration 011) does `SELECT ... FOR UPDATE` then, on a
-- wrong PIN, `UPDATE parties SET pin_attempts = pin_attempts + 1 ...` (and sets
-- pin_locked_until at the 5th failure). That UPDATE runs inside the CALLER's
-- transaction. PostgREST executes each RPC call as exactly ONE transaction. So
-- when the calling RPC then does `RAISE EXCEPTION 'invalid party or PIN'`, the
-- uncaught RAISE aborts that single transaction and rolls back EVERYTHING it
-- did earlier in the same call -- including check_pin_lockout's own increment.
-- pin_attempts therefore stayed 0 forever, no matter how many wrong PINs were
-- tried. Verified empirically (raw psql) by the migration 032 author. The three
-- RPCs below were thus still unthrottled brute-force oracles for the 4-digit
-- host PIN: an attacker holding only the public 6-char party code can read
-- parties.id (anon-readable per 029's column grant) and loop all 10,000 PINs.
--
-- WHY lock_party / update_score / delete_party were NOT affected: they already
-- signal PIN failure with `RETURN FALSE`, not RAISE. A normal RETURN commits
-- the transaction, so check_pin_lockout's increment persists. That is exactly
-- the contract this migration extends to the three RAISE-based RPCs.
--
-- THE FIX: a rejected PIN is an expected, rate-limited condition -- not an
-- exceptional one. On PIN/lockout failure ONLY, each function now returns a
-- sentinel (NULL for the `RETURNS parties` / `RETURNS INTEGER` functions)
-- instead of RAISE, so the enclosing transaction commits and the increment
-- (and the audit-log row, for remove_player) durably persists. Repeated wrong
-- PINs now accumulate and engage the 5-failure / 5-minute lockout on the RPC's
-- OWN attempts, closing the oracle.
--
-- EVERY OTHER failure (party not found, grid already locked, splits not summing
-- to 100, identical matchup teams, blank team name, bad hex color, ...) KEEPS
-- its exact existing RAISE EXCEPTION and message string. Rolling back on those
-- is correct, and clients regex-match those messages. Return TYPES are
-- unchanged (PostgREST contract preserved); only the PIN-failure RETURN VALUE
-- changes. SECURITY DEFINER, the `SET search_path = public, extensions` pin from
-- migration 030, the distinct-matchup-teams validation from 031, and all
-- EXECUTE grants are preserved verbatim.
--
-- Clients (src/lib/stores/game-admin.ts) are updated in lockstep to treat a
-- null/false data return with NO error as "Invalid PIN", identical to how they
-- already humanize the raised 'invalid party or PIN' message -- so an older
-- deployed DB that still RAISEs and a 033+ DB that returns the sentinel yield
-- the same user-facing result.
--
-- DO NOT reintroduce RAISE on the PIN-failure branch of these functions: it
-- silently rolls back check_pin_lockout's increment and reopens the brute-force
-- hole with no compile-time or test-time signal other than the throttle tests
-- in src/tests/integration/pin-lockout-throttle.test.ts.

-- ============================================================
-- update_party_details -- PIN failure returns NULL (was: RAISE)
-- Base: migration 032. Only the PIN-failure branch changes.
-- ============================================================
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
SET search_path = public, extensions
AS $$
DECLARE
  v_party parties;
  v_pin_ok BOOLEAN;
  v_trimmed_event VARCHAR(80);
  v_trimmed_row_name VARCHAR(50);
  v_trimmed_col_name VARCHAR(50);
  v_normalized_row_name TEXT;
  v_normalized_col_name TEXT;
  v_expires_at TIMESTAMPTZ;
BEGIN
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    -- Sentinel refusal, NOT RAISE. A RAISE here aborts this single-statement
    -- PostgREST transaction and rolls back check_pin_lockout's pin_attempts
    -- increment, defeating the throttle. Returning NULL lets the increment
    -- commit. See file header.
    RETURN NULL;
  END IF;

  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'party not found'
      USING ERRCODE = 'no_data_found';
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

  v_normalized_row_name := lower(regexp_replace(v_trimmed_row_name, '\s+', ' ', 'g'));
  v_normalized_col_name := lower(regexp_replace(v_trimmed_col_name, '\s+', ' ', 'g'));
  IF v_normalized_row_name = v_normalized_col_name THEN
    RAISE EXCEPTION 'matchup must use two different teams'
      USING ERRCODE = 'check_violation';
  END IF;

  IF p_team_row_color IS NULL
     OR p_team_col_color IS NULL
     OR p_team_row_color !~ '^#[0-9A-Fa-f]{6}$'
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

-- ============================================================
-- update_payout_structure -- PIN failure returns NULL (was: RAISE)
-- Base: migration 028. `SET search_path = public, extensions` restated to
-- preserve migration 030's pin (CREATE OR REPLACE resets unstated SET options).
-- ============================================================
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
SET search_path = public, extensions
AS $$
DECLARE
  v_party parties;
  v_pin_ok BOOLEAN;
BEGIN
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    -- Sentinel refusal, NOT RAISE (see file header). Lets check_pin_lockout's
    -- increment commit so repeated wrong PINs durably throttle.
    RETURN NULL;
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

-- ============================================================
-- remove_player -- PIN failure returns NULL (was: RAISE)
-- Base: migration 029. `SET search_path` widened to `public, extensions` to
-- match migration 030's pin. As a correctness bonus, the failed-attempt
-- audit-log row now also durably persists (the prior RAISE rolled it back too).
-- ============================================================
CREATE OR REPLACE FUNCTION remove_player(
    p_party_id UUID,
    p_pin VARCHAR(4),
    p_player_name_lower VARCHAR(50)
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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
        -- Sentinel refusal, NOT RAISE (see file header). A RAISE would roll back
        -- BOTH this audit-log row AND check_pin_lockout's increment. NULL (not 0)
        -- so callers can distinguish a rejected PIN from a legitimate
        -- "matched no squares" result of 0.
        RETURN NULL;
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

-- Preserve the EXECUTE grants explicitly (CREATE OR REPLACE keeps ACLs, but
-- restating keeps the security contract legible in one place).
REVOKE ALL ON FUNCTION update_party_details(
  UUID, VARCHAR(4), VARCHAR(80), TIMESTAMPTZ, VARCHAR(50), VARCHAR(50), VARCHAR(7), VARCHAR(7)
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_party_details(
  UUID, VARCHAR(4), VARCHAR(80), TIMESTAMPTZ, VARCHAR(50), VARCHAR(50), VARCHAR(7), VARCHAR(7)
) TO anon, authenticated;

REVOKE ALL ON FUNCTION update_payout_structure(
  UUID, VARCHAR(4), INTEGER, INTEGER, INTEGER, INTEGER
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_payout_structure(
  UUID, VARCHAR(4), INTEGER, INTEGER, INTEGER, INTEGER
) TO anon, authenticated;

REVOKE ALL ON FUNCTION remove_player(UUID, VARCHAR(4), VARCHAR(50)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION remove_player(UUID, VARCHAR(4), VARCHAR(50)) TO anon, authenticated;
