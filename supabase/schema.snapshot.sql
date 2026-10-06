-- GENERATED FILE - never hand-edit. Regenerate with `npm run db:snapshot`
-- after adding a migration. This is the place to read current RPC bodies
-- (migrations only show history; this shows the resulting schema).



SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_party RECORD;
  v_row_digit INT;
  v_col_digit INT;
  v_winning_row INT;
  v_winning_col INT;
  v_winner_name TEXT;
  v_total_pot NUMERIC;
  v_quarter_pct INT;
  v_amount NUMERIC;
BEGIN
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
    RETURN FALSE;
  END IF;

  IF p_row_score < 0 OR p_col_score < 0 THEN RETURN FALSE; END IF;

  -- Update the per-party score (same logic as update_score minus PIN)
  IF p_quarter = 'q1' THEN
    UPDATE scores SET q1_row_score = p_row_score, q1_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q1;
  ELSIF p_quarter = 'q2' THEN
    UPDATE scores SET q2_row_score = p_row_score, q2_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q2;
  ELSIF p_quarter = 'q3' THEN
    UPDATE scores SET q3_row_score = p_row_score, q3_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q3;
  ELSIF p_quarter = 'final' THEN
    UPDATE scores SET final_row_score = p_row_score, final_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_final;
  ELSE
    RETURN FALSE;
  END IF;

  -- Calculate winning square
  v_row_digit := p_row_score % 10;
  v_col_digit := p_col_score % 10;

  SELECT
    (SELECT idx FROM unnest(n.row_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_row_digit LIMIT 1) - 1,
    (SELECT idx FROM unnest(n.col_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_col_digit LIMIT 1) - 1
  INTO v_winning_row, v_winning_col
  FROM numbers n WHERE n.party_id = p_party_id;

  IF v_winning_row IS NOT NULL AND v_winning_col IS NOT NULL THEN
    SELECT player_name INTO v_winner_name
    FROM squares WHERE party_id = p_party_id AND row_num = v_winning_row AND col_num = v_winning_col;

    IF v_winner_name IS NULL THEN
      PERFORM log_audit_event('auto_update_score_failed', p_party_id,
        jsonb_build_object('reason', 'null_winner', 'row', v_winning_row, 'col', v_winning_col));
      RETURN FALSE;
    END IF;

    v_total_pot := v_party.square_price * 100;
    v_amount := v_total_pot * v_quarter_pct / 100;

    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name, v_amount)
    ON CONFLICT (party_id, quarter) DO UPDATE SET
      winning_row = EXCLUDED.winning_row, winning_col = EXCLUDED.winning_col,
      player_name = EXCLUDED.player_name, amount = EXCLUDED.amount;
  END IF;

  IF p_quarter = 'final' THEN
    UPDATE parties SET status = 'complete', updated_at = NOW() WHERE id = p_party_id;
  END IF;

  PERFORM log_audit_event('auto_update_score_success', p_party_id,
    jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_party RECORD;
  v_game RECORD;
  v_quarters TEXT[] := ARRAY['q1', 'q2', 'q3', 'final'];
  v_q TEXT;
  v_home INT;
  v_away INT;
  v_row_score INT;
  v_col_score INT;
BEGIN
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.game_id IS NULL THEN RETURN; END IF;

  SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Propagate any already-completed quarters
  FOR v_q IN SELECT unnest(v_quarters) LOOP
    EXECUTE format('SELECT ($1).%I, ($1).%I', v_q || '_home', v_q || '_away')
      INTO v_home, v_away USING v_game;

    IF v_home IS NOT NULL THEN
      -- Use COALESCE for safety, even though column is now NOT NULL
      IF COALESCE(v_party.home_team_is_row, TRUE) THEN
        v_row_score := v_home; v_col_score := v_away;
      ELSE
        v_row_score := v_away; v_col_score := v_home;
      END IF;

      PERFORM auto_update_score(p_party_id, v_q, v_row_score, v_col_score);
    END IF;
  END LOOP;
END;
$_$;


ALTER FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_pin_lockout"("p_party_id" "uuid", "p_pin" character varying) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_party RECORD;
BEGIN
  SELECT host_pin, pin_attempts, pin_locked_until
  INTO v_party
  FROM parties
  WHERE id = p_party_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Check if currently locked out
  IF v_party.pin_locked_until IS NOT NULL AND v_party.pin_locked_until > NOW() THEN
    RETURN FALSE;
  END IF;

  -- If lockout expired, reset attempts
  IF v_party.pin_locked_until IS NOT NULL AND v_party.pin_locked_until <= NOW() THEN
    UPDATE parties SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_party_id;
  END IF;

  -- Check PIN
  IF v_party.host_pin = p_pin THEN
    -- Reset attempts on success
    UPDATE parties SET pin_attempts = 0, pin_locked_until = NULL WHERE id = p_party_id;
    RETURN TRUE;
  ELSE
    -- Increment failure count
    UPDATE parties
    SET pin_attempts = pin_attempts + 1,
        pin_locked_until = CASE
          WHEN pin_attempts + 1 >= 5 THEN NOW() + INTERVAL '5 minutes'
          ELSE pin_locked_until
        END
    WHERE id = p_party_id;
    RETURN FALSE;
  END IF;
END;
$$;


ALTER FUNCTION "public"."check_pin_lockout"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_push_subscription_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  IF (SELECT COUNT(*) FROM push_subscriptions WHERE party_id = NEW.party_id) >= 200 THEN
    RAISE EXCEPTION 'Push subscription limit reached for this party';
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_push_subscription_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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

    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN FALSE;
    END IF;

    UPDATE squares
    SET player_name = v_trimmed_name, claimed_at = NOW()
    WHERE party_id = p_party_id
      AND row_num = p_row
      AND col_num = p_col
      AND player_name IS NULL;

    GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
    RETURN v_rows_affected > 0;
END;
$$;


ALTER FUNCTION "public"."claim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_squares_batch"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_claimed_count INTEGER := 0;
    v_trimmed_name VARCHAR(50);
BEGIN
    v_trimmed_name := TRIM(p_player_name);
    IF v_trimmed_name = '' OR v_trimmed_name IS NULL THEN
        RETURN 0;
    END IF;

    SELECT status INTO v_party_status FROM parties WHERE id = p_party_id;
    IF v_party_status IS NULL OR v_party_status != 'filling' THEN
        RETURN 0;
    END IF;

    UPDATE squares
    SET player_name = v_trimmed_name, claimed_at = NOW()
    WHERE party_id = p_party_id
      AND player_name IS NULL
      AND (row_num, col_num) IN (
          SELECT (elem->>'row')::INTEGER, (elem->>'col')::INTEGER
          FROM jsonb_array_elements(p_cells) AS elem
      );

    GET DIAGNOSTICS v_claimed_count = ROW_COUNT;
    RETURN v_claimed_count;
END;
$$;


ALTER FUNCTION "public"."claim_squares_batch"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."parties" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" character varying(6) NOT NULL,
    "host_pin" character varying(4) NOT NULL,
    "square_price" numeric(10,2) DEFAULT 1.00 NOT NULL,
    "split_q1" integer DEFAULT 25 NOT NULL,
    "split_q2" integer DEFAULT 25 NOT NULL,
    "split_q3" integer DEFAULT 25 NOT NULL,
    "split_final" integer DEFAULT 25 NOT NULL,
    "status" character varying(20) DEFAULT 'filling'::character varying NOT NULL,
    "team_row_name" character varying(50) DEFAULT 'Seahawks'::character varying NOT NULL,
    "team_col_name" character varying(50) DEFAULT 'Patriots'::character varying NOT NULL,
    "team_row_color" character varying(7) DEFAULT '#69BE28'::character varying NOT NULL,
    "team_col_color" character varying(7) DEFAULT '#C60C30'::character varying NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '30 days'::interval) NOT NULL,
    "host_name_lower" character varying(50),
    "pin_attempts" integer DEFAULT 0 NOT NULL,
    "pin_locked_until" timestamp with time zone,
    "game_id" character varying(20),
    "home_team_is_row" boolean DEFAULT true NOT NULL,
    "event_name" character varying(80) DEFAULT 'Football Squares'::character varying NOT NULL,
    "kickoff_at" timestamp with time zone,
    CONSTRAINT "parties_split_final_check" CHECK ((("split_final" >= 0) AND ("split_final" <= 100))),
    CONSTRAINT "parties_split_q1_check" CHECK ((("split_q1" >= 0) AND ("split_q1" <= 100))),
    CONSTRAINT "parties_split_q2_check" CHECK ((("split_q2" >= 0) AND ("split_q2" <= 100))),
    CONSTRAINT "parties_split_q3_check" CHECK ((("split_q3" >= 0) AND ("split_q3" <= 100))),
    CONSTRAINT "parties_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['filling'::character varying, 'locked'::character varying, 'active'::character varying, 'complete'::character varying])::"text"[]))),
    CONSTRAINT "split_total" CHECK ((((("split_q1" + "split_q2") + "split_q3") + "split_final") = 100))
);


ALTER TABLE "public"."parties" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying DEFAULT 'Seahawks'::character varying, "p_team_col_name" character varying DEFAULT 'Patriots'::character varying, "p_team_row_color" character varying DEFAULT '#69BE28'::character varying, "p_team_col_color" character varying DEFAULT '#C60C30'::character varying, "p_event_name" character varying DEFAULT 'Football Squares'::character varying, "p_kickoff_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "public"."parties"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_alphabet CONSTANT TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_alphabet_len CONSTANT INT := length(v_alphabet);
  v_code VARCHAR(6);
  v_attempt INT;
  v_party parties;
  v_trimmed_host VARCHAR(50);
  v_trimmed_event VARCHAR(80);
  v_trimmed_row_name VARCHAR(50);
  v_trimmed_col_name VARCHAR(50);
  v_normalized_row_name TEXT;
  v_normalized_col_name TEXT;
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
        v_trimmed_row_name, v_trimmed_col_name,
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
$_$;


ALTER FUNCTION "public"."create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."delete_party"("p_party_id" "uuid", "p_pin" character varying) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_pin_ok BOOLEAN;
  v_code VARCHAR(6);
BEGIN
  -- Get party code for logging before deletion
  SELECT code INTO v_code FROM parties WHERE id = p_party_id;

  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    PERFORM log_audit_event('delete_party_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_pin_or_lockout'));
    RETURN FALSE;
  END IF;

  -- Log before delete (since party_id will be gone after)
  PERFORM log_audit_event('delete_party_success', NULL,
    jsonb_build_object('deleted_party_id', p_party_id, 'code', v_code));

  -- Delete the party (cascades to all related tables)
  DELETE FROM parties WHERE id = p_party_id;
  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."delete_party"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lock_party"("p_party_id" "uuid", "p_pin" character varying) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."lock_party"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb" DEFAULT NULL::"jsonb") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
    INSERT INTO audit_log (event_type, party_id, details)
    VALUES (p_event_type, p_party_id, p_details);
END;
$$;


ALTER FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propagate_game_scores"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
  v_party RECORD;
  v_new_home INT;
  v_old_home INT;
  v_row_score INT;
  v_col_score INT;
  v_q TEXT;
  v_quarters TEXT[] := ARRAY['q1', 'q2', 'q3', 'final'];
BEGIN
  FOR v_party IN
    SELECT id, home_team_is_row FROM parties
    WHERE game_id = NEW.game_id AND status IN ('locked', 'active')
  LOOP
    FOR v_q IN SELECT unnest(v_quarters) LOOP
      EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_new_home USING NEW;

      -- OLD is only defined for UPDATE operations, not INSERT
      IF TG_OP = 'UPDATE' THEN
        EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_old_home USING OLD;
      ELSE
        v_old_home := NULL;
      END IF;

      -- Only fire on first non-null value for this quarter (quarter just ended)
      IF v_new_home IS NOT NULL AND v_old_home IS NULL THEN
        -- Use COALESCE for safety, even though column is now NOT NULL
        IF COALESCE(v_party.home_team_is_row, TRUE) THEN
          v_row_score := v_new_home;
          EXECUTE format('SELECT ($1).%I', v_q || '_away') INTO v_col_score USING NEW;
        ELSE
          EXECUTE format('SELECT ($1).%I', v_q || '_away') INTO v_row_score USING NEW;
          v_col_score := v_new_home;
        END IF;

        PERFORM auto_update_score(v_party.id, v_q, v_row_score, v_col_score);
      END IF;
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$_$;


ALTER FUNCTION "public"."propagate_game_scores"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_party_json"("p_party" "public"."parties") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
    SELECT to_jsonb(p_party) - 'host_pin' - 'pin_attempts' - 'pin_locked_until';
$$;


ALTER FUNCTION "public"."public_party_json"("p_party" "public"."parties") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name_lower" character varying) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name_lower" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."start_game"("p_party_id" "uuid", "p_pin" character varying) RETURNS boolean
    LANGUAGE "plpgsql"
    AS $$
DECLARE
    v_party_status VARCHAR(20);
    v_host_pin VARCHAR(4);
BEGIN
    SELECT status, host_pin INTO v_party_status, v_host_pin
    FROM parties WHERE id = p_party_id;

    IF v_host_pin != p_pin THEN
        RETURN FALSE;
    END IF;

    IF v_party_status != 'locked' THEN
        RETURN FALSE;
    END IF;

    UPDATE parties
    SET status = 'active'
    WHERE id = p_party_id;

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."start_game"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_party_home_team_mapping"("p_party_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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
  IF NOT FOUND THEN
    RAISE EXCEPTION 'party not found'
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_party.game_id IS NULL THEN
    RETURN public_party_json(v_party);
  END IF;

  SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
  IF NOT FOUND THEN
    RETURN public_party_json(v_party);
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
    RETURN public_party_json(v_party);
  END IF;

  IF v_home_is_row IS DISTINCT FROM v_party.home_team_is_row THEN
    UPDATE parties
    SET home_team_is_row = v_home_is_row
    WHERE id = p_party_id
    RETURNING * INTO v_party;
  END IF;

  RETURN public_party_json(v_party);
END;
$$;


ALTER FUNCTION "public"."sync_party_home_team_mapping"("p_party_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_party_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_team_row_name" character varying DEFAULT 'Seahawks'::character varying, "p_team_col_name" character varying DEFAULT 'Patriots'::character varying, "p_team_row_color" character varying DEFAULT '#69BE28'::character varying, "p_team_col_color" character varying DEFAULT '#C60C30'::character varying) RETURNS "public"."parties"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
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
$_$;


ALTER FUNCTION "public"."update_party_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_payout_structure"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) RETURNS "public"."parties"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."update_payout_structure"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_party RECORD;
  v_pin_ok BOOLEAN;
  v_row_digit INT;
  v_col_digit INT;
  v_winning_row INT;
  v_winning_col INT;
  v_winner_name TEXT;
  v_total_pot NUMERIC;
  v_quarter_pct INT;
  v_amount NUMERIC;
BEGIN
  -- Check PIN with rate limiting
  v_pin_ok := check_pin_lockout(p_party_id, p_pin);
  IF NOT v_pin_ok THEN
    PERFORM log_audit_event('update_score_failed', p_party_id,
      jsonb_build_object('reason', 'invalid_pin_or_lockout'));
    RETURN FALSE;
  END IF;

  -- Get party
  SELECT * INTO v_party FROM parties WHERE id = p_party_id;
  IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
    RETURN FALSE;
  END IF;

  -- Validate scores are non-negative
  IF p_row_score < 0 OR p_col_score < 0 THEN
    RETURN FALSE;
  END IF;

  -- Update the score
  IF p_quarter = 'q1' THEN
    UPDATE scores SET q1_row_score = p_row_score, q1_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q1;
  ELSIF p_quarter = 'q2' THEN
    UPDATE scores SET q2_row_score = p_row_score, q2_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q2;
  ELSIF p_quarter = 'q3' THEN
    UPDATE scores SET q3_row_score = p_row_score, q3_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_q3;
  ELSIF p_quarter = 'final' THEN
    UPDATE scores SET final_row_score = p_row_score, final_col_score = p_col_score WHERE party_id = p_party_id;
    v_quarter_pct := v_party.split_final;
  ELSE
    RETURN FALSE;
  END IF;

  -- Calculate winning square
  v_row_digit := p_row_score % 10;
  v_col_digit := p_col_score % 10;

  -- Find winning row/col in the numbers grid
  SELECT
    (SELECT idx FROM unnest(n.row_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_row_digit LIMIT 1) - 1,
    (SELECT idx FROM unnest(n.col_numbers) WITH ORDINALITY AS t(val, idx) WHERE val = v_col_digit LIMIT 1) - 1
  INTO v_winning_row, v_winning_col
  FROM numbers n
  WHERE n.party_id = p_party_id;

  IF v_winning_row IS NOT NULL AND v_winning_col IS NOT NULL THEN
    -- Get winner name
    SELECT player_name INTO v_winner_name
    FROM squares
    WHERE party_id = p_party_id AND row_num = v_winning_row AND col_num = v_winning_col;

    -- Safety check: winner square must have a player (indicates data integrity issue if triggered)
    IF v_winner_name IS NULL THEN
      PERFORM log_audit_event('update_score_failed', p_party_id,
        jsonb_build_object('reason', 'null_winner', 'row', v_winning_row, 'col', v_winning_col));
      RETURN FALSE;
    END IF;

    -- Calculate amount
    v_total_pot := v_party.square_price * 100;
    v_amount := v_total_pot * v_quarter_pct / 100;

    -- Insert or update winner
    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name, v_amount)
    ON CONFLICT (party_id, quarter) DO UPDATE SET
      winning_row = EXCLUDED.winning_row,
      winning_col = EXCLUDED.winning_col,
      player_name = EXCLUDED.player_name,
      amount = EXCLUDED.amount;
  END IF;

  -- If final quarter, mark game as complete
  IF p_quarter = 'final' THEN
    UPDATE parties SET status = 'complete', updated_at = NOW() WHERE id = p_party_id;
  END IF;

  PERFORM log_audit_event('update_score_success', p_party_id,
    jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));

  RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."update_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."verify_host_pin"("p_party_code" character varying, "p_pin" character varying) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
  v_party_id UUID;
BEGIN
  SELECT id INTO v_party_id FROM parties WHERE code = p_party_code;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;
  RETURN check_pin_lockout(v_party_id, p_pin);
END;
$$;


ALTER FUNCTION "public"."verify_host_pin"("p_party_code" character varying, "p_pin" character varying) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" character varying(50) NOT NULL,
    "party_id" "uuid",
    "details" "jsonb",
    "ip_address" "inet",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."game_scores" (
    "game_id" character varying(20) NOT NULL,
    "sport" character varying(10) DEFAULT 'nfl'::character varying NOT NULL,
    "home_team_abbrev" character varying(10) NOT NULL,
    "away_team_abbrev" character varying(10) NOT NULL,
    "home_team_name" character varying(50) NOT NULL,
    "away_team_name" character varying(50) NOT NULL,
    "home_score" integer DEFAULT 0 NOT NULL,
    "away_score" integer DEFAULT 0 NOT NULL,
    "game_clock" character varying(10) DEFAULT ''::character varying NOT NULL,
    "game_quarter" integer DEFAULT 0 NOT NULL,
    "game_status" character varying(20) DEFAULT 'pregame'::character varying NOT NULL,
    "q1_home" integer,
    "q1_away" integer,
    "q2_home" integer,
    "q2_away" integer,
    "q3_home" integer,
    "q3_away" integer,
    "q4_home" integer,
    "q4_away" integer,
    "final_home" integer,
    "final_away" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."game_scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."heartbeat" (
    "id" integer DEFAULT 1 NOT NULL,
    "source" character varying(20) NOT NULL,
    "last_beat" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "heartbeat_id_check" CHECK (("id" = 1))
);


ALTER TABLE "public"."heartbeat" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."numbers" (
    "party_id" "uuid" NOT NULL,
    "row_numbers" integer[] NOT NULL,
    "col_numbers" integer[] NOT NULL,
    "assigned_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "numbers_col_numbers_check" CHECK (("array_length"("col_numbers", 1) = 10)),
    CONSTRAINT "numbers_row_numbers_check" CHECK (("array_length"("row_numbers", 1) = 10))
);


ALTER TABLE "public"."numbers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."push_subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "party_id" "uuid" NOT NULL,
    "player_name" character varying(50) NOT NULL,
    "endpoint" "text" NOT NULL,
    "p256dh" "text" NOT NULL,
    "auth" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "player_name_lower" character varying(50) GENERATED ALWAYS AS ("lower"(("player_name")::"text")) STORED
);


ALTER TABLE "public"."push_subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."scores" (
    "party_id" "uuid" NOT NULL,
    "q1_row_score" integer,
    "q1_col_score" integer,
    "q2_row_score" integer,
    "q2_col_score" integer,
    "q3_row_score" integer,
    "q3_col_score" integer,
    "final_row_score" integer,
    "final_col_score" integer,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."scores" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."squares" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "party_id" "uuid" NOT NULL,
    "row_num" integer NOT NULL,
    "col_num" integer NOT NULL,
    "player_name" character varying(50),
    "player_name_lower" character varying(50) GENERATED ALWAYS AS ("lower"(("player_name")::"text")) STORED,
    "claimed_at" timestamp with time zone,
    CONSTRAINT "squares_col_num_check" CHECK ((("col_num" >= 0) AND ("col_num" <= 9))),
    CONSTRAINT "squares_row_num_check" CHECK ((("row_num" >= 0) AND ("row_num" <= 9)))
);


ALTER TABLE "public"."squares" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."winners" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "party_id" "uuid" NOT NULL,
    "quarter" character varying(10) NOT NULL,
    "winning_row" integer NOT NULL,
    "winning_col" integer NOT NULL,
    "player_name" character varying(50) NOT NULL,
    "amount" numeric(10,2) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "winners_quarter_check" CHECK ((("quarter")::"text" = ANY ((ARRAY['q1'::character varying, 'q2'::character varying, 'q3'::character varying, 'final'::character varying])::"text"[]))),
    CONSTRAINT "winners_winning_col_check" CHECK ((("winning_col" >= 0) AND ("winning_col" <= 9))),
    CONSTRAINT "winners_winning_row_check" CHECK ((("winning_row" >= 0) AND ("winning_row" <= 9)))
);


ALTER TABLE "public"."winners" OWNER TO "postgres";


ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."game_scores"
    ADD CONSTRAINT "game_scores_pkey" PRIMARY KEY ("game_id");



ALTER TABLE ONLY "public"."heartbeat"
    ADD CONSTRAINT "heartbeat_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."numbers"
    ADD CONSTRAINT "numbers_pkey" PRIMARY KEY ("party_id");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_party_id_endpoint_key" UNIQUE ("party_id", "endpoint");



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_pkey" PRIMARY KEY ("party_id");



ALTER TABLE ONLY "public"."squares"
    ADD CONSTRAINT "squares_party_id_row_num_col_num_key" UNIQUE ("party_id", "row_num", "col_num");



ALTER TABLE ONLY "public"."squares"
    ADD CONSTRAINT "squares_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."winners"
    ADD CONSTRAINT "winners_party_id_quarter_key" UNIQUE ("party_id", "quarter");



ALTER TABLE ONLY "public"."winners"
    ADD CONSTRAINT "winners_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_audit_log_created" ON "public"."audit_log" USING "btree" ("created_at");



CREATE INDEX "idx_audit_log_event" ON "public"."audit_log" USING "btree" ("event_type");



CREATE INDEX "idx_audit_log_party" ON "public"."audit_log" USING "btree" ("party_id");



CREATE INDEX "idx_parties_code" ON "public"."parties" USING "btree" ("code");



CREATE INDEX "idx_parties_expires" ON "public"."parties" USING "btree" ("expires_at");



CREATE INDEX "idx_parties_game_id" ON "public"."parties" USING "btree" ("game_id");



CREATE INDEX "idx_parties_host_name" ON "public"."parties" USING "btree" ("host_name_lower");



CREATE INDEX "idx_push_subscriptions_party" ON "public"."push_subscriptions" USING "btree" ("party_id");



CREATE INDEX "idx_push_subscriptions_party_player" ON "public"."push_subscriptions" USING "btree" ("party_id", "player_name_lower");



CREATE INDEX "idx_squares_party" ON "public"."squares" USING "btree" ("party_id");



CREATE INDEX "idx_squares_player" ON "public"."squares" USING "btree" ("player_name_lower");



CREATE INDEX "idx_winners_party" ON "public"."winners" USING "btree" ("party_id");



CREATE OR REPLACE TRIGGER "enforce_push_subscription_limit" BEFORE INSERT ON "public"."push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."check_push_subscription_limit"();



CREATE OR REPLACE TRIGGER "game_scores_propagate" AFTER INSERT OR UPDATE ON "public"."game_scores" FOR EACH ROW EXECUTE FUNCTION "public"."propagate_game_scores"();



CREATE OR REPLACE TRIGGER "parties_updated_at" BEFORE UPDATE ON "public"."parties" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



CREATE OR REPLACE TRIGGER "scores_updated_at" BEFORE UPDATE ON "public"."scores" FOR EACH ROW EXECUTE FUNCTION "public"."update_updated_at"();



ALTER TABLE ONLY "public"."audit_log"
    ADD CONSTRAINT "audit_log_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."numbers"
    ADD CONSTRAINT "numbers_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."parties"
    ADD CONSTRAINT "parties_game_id_fkey" FOREIGN KEY ("game_id") REFERENCES "public"."game_scores"("game_id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."push_subscriptions"
    ADD CONSTRAINT "push_subscriptions_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."scores"
    ADD CONSTRAINT "scores_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."squares"
    ADD CONSTRAINT "squares_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."winners"
    ADD CONSTRAINT "winners_party_id_fkey" FOREIGN KEY ("party_id") REFERENCES "public"."parties"("id") ON DELETE CASCADE;



CREATE POLICY "Anyone can read game_scores" ON "public"."game_scores" FOR SELECT USING (true);



CREATE POLICY "Anyone can read heartbeat" ON "public"."heartbeat" FOR SELECT USING (true);



CREATE POLICY "Anyone can read numbers" ON "public"."numbers" FOR SELECT USING (true);



CREATE POLICY "Anyone can read parties" ON "public"."parties" FOR SELECT USING (true);



CREATE POLICY "Anyone can read scores" ON "public"."scores" FOR SELECT USING (true);



CREATE POLICY "Anyone can read squares" ON "public"."squares" FOR SELECT USING (true);



CREATE POLICY "Anyone can read winners" ON "public"."winners" FOR SELECT USING (true);



CREATE POLICY "Anyone can unsubscribe by endpoint" ON "public"."push_subscriptions" FOR DELETE USING (true);



CREATE POLICY "Players can subscribe" ON "public"."push_subscriptions" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."squares"
  WHERE (("squares"."party_id" = "push_subscriptions"."party_id") AND ("lower"(("squares"."player_name")::"text") = "lower"(("push_subscriptions"."player_name")::"text"))))));



CREATE POLICY "Service role can read subscriptions" ON "public"."push_subscriptions" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Service role only" ON "public"."audit_log" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "Update subscription with valid player" ON "public"."push_subscriptions" FOR UPDATE USING (true) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."squares"
  WHERE (("squares"."party_id" = "push_subscriptions"."party_id") AND ("lower"(("squares"."player_name")::"text") = "lower"(("push_subscriptions"."player_name")::"text"))))));



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."heartbeat" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."numbers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."parties" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."push_subscriptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."scores" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."squares" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."winners" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."game_scores";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."numbers";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."parties";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."scores";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."squares";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."winners";






GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";































































































































































REVOKE ALL ON FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."check_pin_lockout"("p_party_id" "uuid", "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."check_pin_lockout"("p_party_id" "uuid", "p_pin" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_pin_lockout"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."check_push_subscription_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."check_push_subscription_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."check_push_subscription_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."claim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_squares_batch"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_squares_batch"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_squares_batch"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_squares_batch"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") TO "service_role";



GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."parties" TO "anon";
GRANT REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."parties" TO "authenticated";
GRANT ALL ON TABLE "public"."parties" TO "service_role";



GRANT SELECT("id") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("id") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("code") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("code") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("square_price") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("square_price") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("split_q1") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("split_q1") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("split_q2") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("split_q2") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("split_q3") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("split_q3") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("split_final") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("split_final") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("status") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("status") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("team_row_name") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("team_row_name") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("team_col_name") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("team_col_name") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("team_row_color") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("team_row_color") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("team_col_color") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("team_col_color") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("created_at") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("created_at") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("updated_at") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("updated_at") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("expires_at") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("expires_at") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("host_name_lower") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("host_name_lower") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("game_id") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("game_id") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("home_team_is_row") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("home_team_is_row") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("event_name") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("event_name") ON TABLE "public"."parties" TO "authenticated";



GRANT SELECT("kickoff_at") ON TABLE "public"."parties" TO "anon";
GRANT SELECT("kickoff_at") ON TABLE "public"."parties" TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) TO "service_role";



GRANT ALL ON FUNCTION "public"."delete_party"("p_party_id" "uuid", "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."delete_party"("p_party_id" "uuid", "p_pin" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."delete_party"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."lock_party"("p_party_id" "uuid", "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."lock_party"("p_party_id" "uuid", "p_pin" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."lock_party"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."propagate_game_scores"() TO "anon";
GRANT ALL ON FUNCTION "public"."propagate_game_scores"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."propagate_game_scores"() TO "service_role";



GRANT ALL ON FUNCTION "public"."public_party_json"("p_party" "public"."parties") TO "anon";
GRANT ALL ON FUNCTION "public"."public_party_json"("p_party" "public"."parties") TO "authenticated";
GRANT ALL ON FUNCTION "public"."public_party_json"("p_party" "public"."parties") TO "service_role";



REVOKE ALL ON FUNCTION "public"."remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name_lower" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name_lower" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name_lower" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name_lower" character varying) TO "service_role";



GRANT ALL ON FUNCTION "public"."start_game"("p_party_id" "uuid", "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."start_game"("p_party_id" "uuid", "p_pin" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."start_game"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_party_home_team_mapping"("p_party_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_party_home_team_mapping"("p_party_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."sync_party_home_team_mapping"("p_party_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_party_home_team_mapping"("p_party_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_party_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_party_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."update_party_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_party_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_payout_structure"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_payout_structure"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."update_payout_structure"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_payout_structure"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."update_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "service_role";



GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."verify_host_pin"("p_party_code" character varying, "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."verify_host_pin"("p_party_code" character varying, "p_pin" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."verify_host_pin"("p_party_code" character varying, "p_pin" character varying) TO "service_role";


















GRANT ALL ON TABLE "public"."audit_log" TO "anon";
GRANT ALL ON TABLE "public"."audit_log" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT ALL ON TABLE "public"."game_scores" TO "anon";
GRANT ALL ON TABLE "public"."game_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores" TO "service_role";



GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."heartbeat" TO "anon";
GRANT SELECT,INSERT,REFERENCES,DELETE,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."heartbeat" TO "authenticated";
GRANT ALL ON TABLE "public"."heartbeat" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."numbers" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."numbers" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scores" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."scores" TO "authenticated";
GRANT ALL ON TABLE "public"."scores" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."squares" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."squares" TO "authenticated";
GRANT ALL ON TABLE "public"."squares" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."winners" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."winners" TO "authenticated";
GRANT ALL ON TABLE "public"."winners" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































