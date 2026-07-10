-- 032: Close PIN rate-limit bypass in update_party_details; harden lock_party
-- against a concurrent-unclaim TOCTOU race.
--
-- BUG 1 (security, medium-high): update_party_details authenticates with a raw
-- `SELECT ... WHERE host_pin = p_pin` instead of calling check_pin_lockout()
-- like every sibling host-PIN RPC (lock_party, update_score, delete_party,
-- update_payout_structure, remove_player). Because it never increments
-- pin_attempts / sets pin_locked_until, and it is SECURITY DEFINER (so table
-- REVOKEs granted in 029 don't constrain it), an attacker who only knows the
-- public 6-char party code -- readable via the "Anyone can read parties"
-- policy's column grant, which includes `id` -- can brute-force all 10,000
-- 4-digit PINs unthrottled: a wrong PIN raises 'invalid party or PIN', the
-- correct PIN returns the row -- a clean oracle -- then the recovered PIN can
-- be replayed against update_score / delete_party to rig winners or destroy
-- the pool.
--
-- Fix: authenticate update_party_details through check_pin_lockout(), exactly
-- like update_payout_structure (028). Every other behavior of
-- update_party_details -- including the distinct-matchup-teams validation
-- added in 031 -- is preserved unchanged. SECURITY DEFINER and the
-- `SET search_path = public, extensions` pin applied by 030 are preserved.
--
-- KNOWN FOLLOW-UP LIMITATION (discovered while verifying this fix, not
-- introduced by it -- flagging per project policy rather than shipping a
-- rushed, unreviewed workaround): check_pin_lockout()'s own
-- `pin_attempts`/`pin_locked_until` UPDATE, on a wrong-PIN call, does not
-- durably persist when the *caller* subsequently does `RAISE EXCEPTION`.
-- An uncaught RAISE aborts the entire enclosing transaction -- and since
-- PostgREST runs each RPC call as a single transaction, that rolls back
-- every write performed earlier in the *same* call, including
-- check_pin_lockout's own increment. Verified empirically (raw psql against
-- local Postgres): calling update_party_details with a wrong PIN leaves
-- pin_attempts at 0 every time, no matter how many times it's called. This
-- is a pre-existing gap that equally affects update_payout_structure (028)
-- and remove_player (029) -- both already use the identical
-- check-then-RAISE pattern in production, unrelated to this migration.
-- lock_party / update_score / delete_party are NOT affected because they
-- signal failure via `RETURN FALSE` instead of RAISE, so no exception
-- unwinds their transaction and check_pin_lockout's increment commits
-- normally.
--
-- What IS fixed by this migration: update_party_details now correctly
-- respects a lockout already established by those RETURN-based sibling
-- RPCs, because check_pin_lockout's *lockout* check
-- (`pin_locked_until > NOW()`) short-circuits and returns FALSE before
-- attempting any write, so there is nothing for a later RAISE to roll back
-- in that path. Verified empirically: 5 wrong-PIN calls to lock_party
-- durably locks the party out, and update_party_details subsequently
-- rejects even the *correct* PIN while that lockout is active. What is NOT
-- fixed: update_party_details's own repeated wrong-PIN attempts cannot, by
-- themselves, drive a party into lockout, since each attempt's increment is
-- rolled back by that same call's RAISE. See the integration test file for
-- both the passing (cross-RPC lockout is respected) and the documented gap
-- (this RPC's own attempts don't accumulate) as explicit, characterized
-- assertions rather than a silent, undiscovered hole.
--
-- A full fix requires either (a) an autonomous-transaction mechanism (e.g.
-- dblink to a second connection) so the increment survives independently of
-- the caller's outcome, which is a new extension dependency needing its own
-- security review, or (b) moving these three RPCs off RAISE EXCEPTION onto a
-- return-value error contract, which is a breaking change to the client
-- contract these RPCs already ship (src/lib call sites check `error.message`
-- against 'invalid party or PIN' today) and is out of this migration's file
-- scope. Recommended next step: a dedicated follow-up task to pick one of
-- those two approaches deliberately, coordinated with the client code that
-- consumes these three RPCs.
--
-- BUG 2 (data integrity, low): lock_party's fullness check
-- (`SELECT 1 FROM squares WHERE party_id = ... AND player_name IS NULL`) takes
-- no row lock on squares. check_pin_lockout() only locks the parties row
-- (FOR UPDATE on parties), and under READ COMMITTED a concurrent
-- unclaim_square does a plain read of parties.status before its own UPDATE on
-- squares -- it is not serialized against lock_party's parties-row lock.
-- Window: unclaim_square reads status='filling', passes its own gate, and
-- nulls a square's player_name after lock_party's fullness check has already
-- passed but before lock_party commits status='active' -- leaving an
-- 'active' party with an empty square.
--
-- Fix: lock every square row for the party for the duration of the
-- transaction before checking fullness. Postgres disallows `FOR UPDATE` in
-- the same SELECT as an aggregate (`SELECT count(*) ... FOR UPDATE` errors
-- with "FOR UPDATE is not allowed with aggregate functions"), so this is done
-- in two steps: (1) a non-aggregating `PERFORM 1 FROM squares WHERE
-- party_id = ... FOR UPDATE` to acquire a row lock on all 100 rows -- filled
-- AND empty, since locking only the empty rows would not block a concurrent
-- unclaim of an already-filled row -- then (2) a plain EXISTS check against
-- those now-locked rows. The existing null_winner guard in update_score (014)
-- stays as defense-in-depth and is not touched here.
--
-- IMPORTANT -- the squares lock alone is NOT sufficient, and this was
-- verified empirically (two hand-orchestrated concurrent psql sessions
-- against a local Postgres instance) before shipping this migration, not
-- just reasoned about: a concurrent unclaim_square's `UPDATE squares ...`
-- blocks on lock_party's row lock as expected, but once lock_party COMMITS
-- and releases the lock, Postgres re-evaluates unclaim_square's WHERE clause
-- against the fresh row (EvalPlanQual) and it still matches -- because
-- lock_party never touches `squares.player_name` -- so the blocked UPDATE
-- proceeds and nulls the square anyway, just deterministically right after
-- lock_party's commit instead of racily during it. Same corrupted end state
-- (status='active' with an empty square), only the timing changed. Measured:
-- with only the lock_party-side fix applied, the race reproduced 100% of the
-- time in this harness.
--
-- The actual missing piece is that unclaim_square's status gate
-- (`SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;`,
-- 029:75) is a plain, non-locking read -- it never contends with
-- check_pin_lockout's `FOR UPDATE` hold on the same parties row (011:12-16),
-- so it can observe a stale 'filling' status and pass its own gate before
-- lock_party ever commits. Changing that one read to
-- `... FOR UPDATE` forces it to block on lock_party's existing parties-row
-- lock (held for lock_party's entire transaction, from check_pin_lockout
-- onward) whenever the two race, and to re-read the fresh, post-commit
-- status once unblocked -- which is 'active' -- so the existing
-- `IF v_party_status IS NULL OR v_party_status != 'filling' THEN RETURN
-- FALSE` guard now correctly rejects it before it ever reaches the squares
-- UPDATE. Verified this closes the race with the same two-session harness.
-- Whichever of {lock_party, unclaim_square} acquires the parties-row lock
-- first now fully determines a happens-before order, and the loser always
-- observes the winner's committed state. claim_square does not need the same
-- treatment: claiming requires `player_name IS NULL`, so once a party is
-- genuinely full there is nothing left for a racing claim to match, and a
-- claim landing on the last empty square exactly as lock_party evaluates
-- fullness is a benign outcome (the grid legitimately became full), not
-- corruption.

-- ============================================================
-- BUG 1: update_party_details -- authenticate via check_pin_lockout
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
    RAISE EXCEPTION 'invalid party or PIN'
      USING ERRCODE = 'invalid_authorization_specification';
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
-- BUG 2: lock_party -- lock all square rows before checking fullness
-- ============================================================
CREATE OR REPLACE FUNCTION lock_party(p_party_id UUID, p_pin VARCHAR(4))
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_party RECORD;
  v_pin_ok BOOLEAN;
BEGIN
  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    PERFORM log_audit_event('lock_party_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_pin_or_lockout'));
    RETURN FALSE;
  END IF;

  -- Get party for status check
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status != 'filling' THEN
    PERFORM log_audit_event('lock_party_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_status', 'status', COALESCE(v_party.status, 'not_found')));
    RETURN FALSE;
  END IF;

  -- Lock every square row for this party for the rest of the transaction.
  -- Locking only the empty rows would not block a concurrent unclaim_square of
  -- an already-filled row, so all 100 rows are locked here. `FOR UPDATE`
  -- cannot be combined with an aggregate in the same SELECT, so fullness is
  -- checked separately below against these now-locked rows -- any concurrent
  -- claim_square/unclaim_square UPDATE against this party's squares blocks
  -- until this transaction commits or rolls back.
  PERFORM 1 FROM squares WHERE party_id = p_party_id FOR UPDATE;

  -- Verify all squares are filled
  IF EXISTS (
    SELECT 1 FROM squares
    WHERE party_id = p_party_id AND player_name IS NULL
  ) THEN
    PERFORM log_audit_event('lock_party_failed', p_party_id,
      jsonb_build_object('reason', 'incomplete_grid'));
    RETURN FALSE;
  END IF;

  -- Generate random numbers (0-9 for each position)
  INSERT INTO numbers (party_id, row_numbers, col_numbers)
  VALUES (
    p_party_id,
    (SELECT array_agg(n ORDER BY random()) FROM generate_series(0, 9) AS n),
    (SELECT array_agg(n ORDER BY random()) FROM generate_series(0, 9) AS n)
  )
  ON CONFLICT (party_id) DO UPDATE SET
    row_numbers = EXCLUDED.row_numbers,
    col_numbers = EXCLUDED.col_numbers,
    assigned_at = NOW();

  -- Insert scores row (idempotent via ON CONFLICT)
  INSERT INTO scores (party_id)
  VALUES (p_party_id)
  ON CONFLICT (party_id) DO NOTHING;

  -- Update party status to active
  UPDATE parties SET status = 'active', updated_at = NOW() WHERE id = p_party_id;

  PERFORM log_audit_event('lock_party_success', p_party_id, NULL);
  RETURN TRUE;
END;
$$;

-- ============================================================
-- BUG 2 (companion fix): unclaim_square -- serialize its status gate
-- against lock_party via the parties row lock (see rationale above)
-- ============================================================
CREATE OR REPLACE FUNCTION unclaim_square(
    p_party_id UUID,
    p_row INTEGER,
    p_col INTEGER,
    p_player_name VARCHAR(50)
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

    -- FOR UPDATE: serializes against lock_party's check_pin_lockout, which
    -- holds a FOR UPDATE lock on this same parties row for lock_party's
    -- entire transaction. Without this, a plain read here can observe a
    -- stale 'filling' status and race past lock_party's commit -- see the
    -- BUG 2 comment above this file for the empirically-verified mechanism.
    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id FOR UPDATE;
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
