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





SET default_tablespace = '';

SET default_table_access_method = "heap";


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


CREATE OR REPLACE FUNCTION "public"."apply_game_scores"("p_party_id" "uuid", "p_home_is_row" boolean, "p_new" "public"."game_scores", "p_old" "public"."game_scores") RETURNS "void"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
	v_q TEXT;
	v_home INT;
	v_away INT;
	v_old_home INT;
BEGIN
	FOREACH v_q IN ARRAY ARRAY['q1', 'q2', 'q3', 'final'] LOOP
		EXECUTE format('SELECT ($1).%I, ($1).%I', v_q || '_home', v_q || '_away')
			INTO v_home, v_away USING p_new;
		EXECUTE format('SELECT ($1).%I', v_q || '_home') INTO v_old_home USING p_old;

		IF v_home IS NOT NULL AND v_old_home IS NULL THEN
			IF p_home_is_row THEN
				PERFORM auto_update_score(p_party_id, v_q, v_home, v_away);
			ELSE
				PERFORM auto_update_score(p_party_id, v_q, v_away, v_home);
			END IF;
		END IF;
	END LOOP;
END;
$_$;


ALTER FUNCTION "public"."apply_game_scores"("p_party_id" "uuid", "p_home_is_row" boolean, "p_new" "public"."game_scores", "p_old" "public"."game_scores") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_problem TEXT;
BEGIN
    -- Everything, logging included, runs in the subtransaction: a party deleted
    -- mid-trigger would otherwise fail the audit FK and abort the whole update.
    BEGIN
        v_problem := record_quarter_score(p_party_id, p_quarter, p_row_score, p_col_score);
        IF v_problem IS NOT NULL THEN
            PERFORM log_audit_event('auto_update_score_failed', p_party_id,
                jsonb_build_object('reason', v_problem, 'quarter', p_quarter));
            RETURN FALSE;
        END IF;
        PERFORM log_audit_event('auto_update_score_success', p_party_id,
            jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));
        RETURN TRUE;
    EXCEPTION WHEN OTHERS THEN
        PERFORM log_audit_event('auto_update_score_failed', NULL,
            jsonb_build_object('party_id', p_party_id, 'reason', SQLERRM, 'quarter', p_quarter));
        RETURN FALSE;
    END;
END;
$$;


ALTER FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
	v_party RECORD;
	v_game public.game_scores;
BEGIN
	SELECT id, game_id, home_team_is_row INTO v_party FROM parties WHERE id = p_party_id;
	IF NOT FOUND OR v_party.game_id IS NULL THEN RETURN; END IF;

	SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
	IF NOT FOUND THEN RETURN; END IF;

	PERFORM apply_game_scores(p_party_id, v_party.home_team_is_row, v_game, NULL);
END;
$$;


ALTER FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."claim_squares"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_name TEXT := TRIM(p_player_name);
    v_status TEXT;
    v_claimed JSONB;
    v_taken JSONB;
BEGIN
    IF COALESCE(v_name, '') = '' OR length(v_name) > 50 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'player_name');
    END IF;

    IF jsonb_typeof(p_cells) IS DISTINCT FROM 'array' OR jsonb_array_length(p_cells) = 0
       OR jsonb_array_length(p_cells) > 100
       OR EXISTS (
           SELECT 1 FROM jsonb_array_elements(p_cells) AS c
           -- CASE so the casts only run on numbers (OR does not short-circuit).
           WHERE CASE
               WHEN jsonb_typeof(c -> 'row') = 'number' AND jsonb_typeof(c -> 'col') = 'number'
                   THEN (c ->> 'row')::NUMERIC NOT IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9)
                     OR (c ->> 'col')::NUMERIC NOT IN (0, 1, 2, 3, 4, 5, 6, 7, 8, 9)
               ELSE TRUE
           END
       ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'invalid_input', 'field', 'cells');
    END IF;

    -- A plain read is enough: claims only fill empty squares, and host_lock_party
    -- refuses while any square is empty, so a claim racing the lock cannot leave
    -- a locked grid with a hole.
    SELECT status INTO v_status FROM parties WHERE id = p_party_id;
    IF v_status IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'not_found');
    END IF;
    IF v_status <> 'filling' THEN
        RETURN jsonb_build_object('ok', false, 'error', 'wrong_status');
    END IF;

    WITH requested AS (
        SELECT DISTINCT (c ->> 'row')::INT AS row_num, (c ->> 'col')::INT AS col_num
        FROM jsonb_array_elements(p_cells) AS c
    ),
    claimed AS (
        UPDATE squares s
        SET player_name = v_name, claimed_at = NOW()
        FROM requested r
        WHERE s.party_id = p_party_id
          AND s.row_num = r.row_num AND s.col_num = r.col_num
          AND s.player_name IS NULL
        RETURNING s.row_num, s.col_num
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('row', row_num, 'col', col_num)), '[]')
    INTO v_claimed
    FROM claimed;

    -- A separate statement takes a fresh snapshot, so a cell another claimer
    -- won while we waited on its row lock shows that claimer as the owner.
    SELECT COALESCE(jsonb_agg(jsonb_build_object('row', s.row_num, 'col', s.col_num,
                                                 'player_name', s.player_name)), '[]')
    INTO v_taken
    FROM squares s
    WHERE s.party_id = p_party_id
      AND (s.row_num, s.col_num) IN (
          SELECT (c ->> 'row')::INT, (c ->> 'col')::INT FROM jsonb_array_elements(p_cells) AS c
      )
      AND NOT EXISTS (
          SELECT 1 FROM jsonb_array_elements(v_claimed) AS k
          WHERE (k ->> 'row')::INT = s.row_num AND (k ->> 'col')::INT = s.col_num
      );

    RETURN jsonb_build_object('ok', true, 'claimed', v_claimed, 'taken', v_taken);
END;
$$;


ALTER FUNCTION "public"."claim_squares"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."game_side"("p_row_name" "text", "p_col_name" "text", "p_game" "public"."game_scores") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
    WITH n AS (
        SELECT lower(p_row_name) AS r, lower(p_col_name) AS c,
               lower(p_game.home_team_name) AS hn, lower(p_game.home_team_abbrev) AS ha,
               lower(p_game.away_team_name) AS an, lower(p_game.away_team_abbrev) AS aa
    ),
    m AS (
        SELECT (strpos(hn, r) > 0 OR strpos(r, hn) > 0 OR ha = r) AS row_home,
               (strpos(an, r) > 0 OR strpos(r, an) > 0 OR aa = r) AS row_away,
               (strpos(hn, c) > 0 OR strpos(c, hn) > 0 OR ha = c) AS col_home,
               (strpos(an, c) > 0 OR strpos(c, an) > 0 OR aa = c) AS col_away
        FROM n
    )
    SELECT CASE
        WHEN row_home AND col_away THEN TRUE
        WHEN row_away AND col_home THEN FALSE
    END
    FROM m;
$$;


ALTER FUNCTION "public"."game_side"("p_row_name" "text", "p_col_name" "text", "p_game" "public"."game_scores") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_party_preview"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
    SELECT jsonb_build_object(
        'party', public_party_json(p),
        'filled_count', (SELECT count(*) FROM squares s
                         WHERE s.party_id = p.id AND s.player_name IS NOT NULL)
    )
    FROM parties p
    WHERE p.code = upper(p_code);
$$;


ALTER FUNCTION "public"."get_party_preview"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_party_state"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_party parties;
    v_game game_scores;
    v_home_is_row BOOLEAN;
BEGIN
    SELECT * INTO v_party FROM parties WHERE code = upper(p_code);
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;

    IF v_party.game_id IS NOT NULL THEN
        SELECT * INTO v_game FROM game_scores WHERE game_id = v_party.game_id;
        v_home_is_row := v_party.home_team_is_row;
    ELSE
        SELECT * INTO v_game FROM game_scores g
        WHERE g.game_status <> 'final'
          AND game_side(v_party.team_row_name, v_party.team_col_name, g) IS NOT NULL
        ORDER BY g.updated_at DESC
        LIMIT 1;
        v_home_is_row := game_side(v_party.team_row_name, v_party.team_col_name, v_game);
    END IF;

    RETURN jsonb_build_object(
        'party', public_party_json(v_party),
        'squares', COALESCE((
            SELECT jsonb_agg(to_jsonb(s) ORDER BY s.row_num, s.col_num)
            FROM squares s WHERE s.party_id = v_party.id), '[]'),
        'numbers', (SELECT to_jsonb(n) FROM numbers n WHERE n.party_id = v_party.id),
        'scores', (SELECT to_jsonb(sc) FROM scores sc WHERE sc.party_id = v_party.id),
        'winners', COALESCE((
            SELECT jsonb_agg(to_jsonb(w) ORDER BY w.quarter)
            FROM winners w WHERE w.party_id = v_party.id), '[]'),
        'game', CASE WHEN v_game.game_id IS NULL THEN NULL ELSE jsonb_build_object(
            'row', to_jsonb(v_game),
            'home_is_row', COALESCE(v_home_is_row, TRUE),
            'linked', v_party.game_id IS NOT NULL
        ) END
    );
END;
$$;


ALTER FUNCTION "public"."get_party_state"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
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
    -- square_price is NUMERIC(10,2): check the value it will be stored as.
    IF p_square_price IS NULL OR round(p_square_price, 2) <= 0 OR round(p_square_price, 2) >= 100000000 THEN
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
$_$;


ALTER FUNCTION "public"."host_create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_delete_party"("p_party_id" "uuid", "p_pin" character varying) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_delete_party"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_gate"("p_party_id" "uuid", "p_pin" character varying, "p_action" "text", "p_required_status" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_gate"("p_party_id" "uuid", "p_pin" character varying, "p_action" "text", "p_required_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_lock_party"("p_party_id" "uuid", "p_pin" character varying) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_lock_party"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_pin_check"("p_party_id" "uuid", "p_pin" character varying) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_pin_check"("p_party_id" "uuid", "p_pin" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_record_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_refusal JSONB;
    v_problem TEXT;
BEGIN
    v_refusal := host_gate(p_party_id, p_pin, 'record_score');
    IF v_refusal IS NOT NULL THEN
        RETURN v_refusal;
    END IF;

    v_problem := record_quarter_score(p_party_id, p_quarter, p_row_score, p_col_score);
    IF v_problem IS NOT NULL THEN
        RETURN host_refusal(p_party_id, 'record_score', v_problem,
            CASE WHEN v_problem = 'invalid_input' THEN 'score' END);
    END IF;

    PERFORM log_audit_event('record_score_success', p_party_id,
        jsonb_build_object('quarter', p_quarter, 'row_score', p_row_score, 'col_score', p_col_score));

    RETURN jsonb_build_object(
        'ok', true,
        'party', (SELECT public_party_json(p) FROM parties p WHERE p.id = p_party_id),
        'scores', (SELECT to_jsonb(s) FROM scores s WHERE s.party_id = p_party_id),
        'winners', COALESCE(
            (SELECT jsonb_agg(to_jsonb(w) ORDER BY w.quarter) FROM winners w WHERE w.party_id = p_party_id),
            '[]'::jsonb)
    );
END;
$$;


ALTER FUNCTION "public"."host_record_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_refusal"("p_party_id" "uuid", "p_action" "text", "p_error" "text", "p_field" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
    IF p_error <> 'not_found' THEN
        PERFORM log_audit_event(p_action || '_failed', p_party_id,
            jsonb_build_object('reason', p_error, 'field', p_field));
    END IF;
    RETURN jsonb_strip_nulls(jsonb_build_object('ok', false, 'error', p_error, 'field', p_field));
END;
$$;


ALTER FUNCTION "public"."host_refusal"("p_party_id" "uuid", "p_action" "text", "p_error" "text", "p_field" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name" character varying) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_update_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_update_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_update_payouts"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
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


ALTER FUNCTION "public"."host_update_payouts"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."host_verify_pin"("p_party_code" character varying, "p_pin" character varying) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
	v_party_id UUID;
	v_check TEXT;
BEGIN
	SELECT id INTO v_party_id FROM parties WHERE code = UPPER(p_party_code);
	IF NOT FOUND THEN
		RETURN host_refusal(NULL, 'verify_pin', 'not_found');
	END IF;

	v_check := host_pin_check(v_party_id, p_pin);
	IF v_check <> 'ok' THEN
		RETURN host_refusal(v_party_id, 'verify_pin', v_check);
	END IF;
	RETURN jsonb_build_object('ok', true);
END;
$$;


ALTER FUNCTION "public"."host_verify_pin"("p_party_code" character varying, "p_pin" character varying) OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."party_details_problem"("p_event_name" "text", "p_team_row_name" "text", "p_team_col_name" "text", "p_team_row_color" "text", "p_team_col_color" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $_$
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
$_$;


ALTER FUNCTION "public"."party_details_problem"("p_event_name" "text", "p_team_row_name" "text", "p_team_col_name" "text", "p_team_row_color" "text", "p_team_col_color" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."party_expiry"("p_kickoff_at" timestamp with time zone) RETURNS timestamp with time zone
    LANGUAGE "sql" STABLE
    AS $$
    SELECT GREATEST(NOW() + INTERVAL '30 days', COALESCE(p_kickoff_at + INTERVAL '14 days', NOW()));
$$;


ALTER FUNCTION "public"."party_expiry"("p_kickoff_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."propagate_game_scores"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
	v_party RECORD;
BEGIN
	FOR v_party IN
		SELECT id, home_team_is_row FROM parties
		WHERE game_id = NEW.game_id AND status IN ('locked', 'active')
	LOOP
		PERFORM apply_game_scores(
			v_party.id,
			v_party.home_team_is_row,
			NEW,
			CASE WHEN TG_OP = 'UPDATE' THEN OLD END
		);
	END LOOP;
	RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."propagate_game_scores"() OWNER TO "postgres";


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
    "team_row_name" character varying(50) NOT NULL,
    "team_col_name" character varying(50) NOT NULL,
    "team_row_color" character varying(7) NOT NULL,
    "team_col_color" character varying(7) NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "host_name_lower" character varying(50),
    "pin_attempts" integer DEFAULT 0 NOT NULL,
    "pin_locked_until" timestamp with time zone,
    "game_id" character varying(20),
    "home_team_is_row" boolean DEFAULT true NOT NULL,
    "event_name" character varying(80) NOT NULL,
    "kickoff_at" timestamp with time zone,
    CONSTRAINT "parties_split_final_check" CHECK ((("split_final" >= 0) AND ("split_final" <= 100))),
    CONSTRAINT "parties_split_q1_check" CHECK ((("split_q1" >= 0) AND ("split_q1" <= 100))),
    CONSTRAINT "parties_split_q2_check" CHECK ((("split_q2" >= 0) AND ("split_q2" <= 100))),
    CONSTRAINT "parties_split_q3_check" CHECK ((("split_q3" >= 0) AND ("split_q3" <= 100))),
    CONSTRAINT "parties_status_check" CHECK ((("status")::"text" = ANY ((ARRAY['filling'::character varying, 'locked'::character varying, 'active'::character varying, 'complete'::character varying])::"text"[]))),
    CONSTRAINT "split_total" CHECK ((((("split_q1" + "split_q2") + "split_q3") + "split_final") = 100))
);


ALTER TABLE "public"."parties" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."public_party_json"("p_party" "public"."parties") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
    SELECT to_jsonb(p_party) - 'host_pin' - 'pin_attempts' - 'pin_locked_until';
$$;


ALTER FUNCTION "public"."public_party_json"("p_party" "public"."parties") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."record_quarter_score"("p_party_id" "uuid", "p_quarter" "text", "p_row_score" integer, "p_col_score" integer) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $_$
DECLARE
    v_party parties;
    v_winning_row INT;
    v_winning_col INT;
    v_winner_name TEXT;
BEGIN
    SELECT * INTO v_party FROM parties WHERE id = p_party_id FOR UPDATE;
    IF NOT FOUND OR v_party.status NOT IN ('active', 'locked') THEN
        RETURN 'wrong_status';
    END IF;

    IF p_quarter IS NULL OR p_quarter <> ALL (ARRAY['q1', 'q2', 'q3', 'final'])
       OR p_row_score IS NULL OR p_col_score IS NULL
       OR p_row_score < 0 OR p_col_score < 0 THEN
        RETURN 'invalid_input';
    END IF;

    -- p_quarter is one of the four names above, so the column names are fixed.
    EXECUTE format('UPDATE scores SET %I = $1, %I = $2 WHERE party_id = $3',
                   p_quarter || '_row_score', p_quarter || '_col_score')
        USING p_row_score, p_col_score, p_party_id;

    -- The winner sits where each team's last digit appears in its numbers.
    SELECT array_position(n.row_numbers, p_row_score % 10) - 1,
           array_position(n.col_numbers, p_col_score % 10) - 1
    INTO v_winning_row, v_winning_col
    FROM numbers n WHERE n.party_id = p_party_id;

    SELECT player_name INTO v_winner_name
    FROM squares
    WHERE party_id = p_party_id AND row_num = v_winning_row AND col_num = v_winning_col;

    IF v_winner_name IS NULL THEN
        RAISE EXCEPTION 'party % has no owner for winning square (%, %) in %',
            p_party_id, v_winning_row, v_winning_col, p_quarter;
    END IF;

    INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
    VALUES (
        p_party_id, p_quarter, v_winning_row, v_winning_col, v_winner_name,
        v_party.square_price * 100 * (to_jsonb(v_party) ->> ('split_' || p_quarter))::INT / 100
    )
    ON CONFLICT (party_id, quarter) DO UPDATE SET
        winning_row = EXCLUDED.winning_row,
        winning_col = EXCLUDED.winning_col,
        player_name = EXCLUDED.player_name,
        amount = EXCLUDED.amount;

    IF p_quarter = 'final' THEN
        UPDATE parties SET status = 'complete' WHERE id = p_party_id;
    END IF;

    RETURN NULL;
END;
$_$;


ALTER FUNCTION "public"."record_quarter_score"("p_party_id" "uuid", "p_quarter" "text", "p_row_score" integer, "p_col_score" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."save_push_subscription"("p_party_id" "uuid", "p_player_name" character varying, "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
    -- send-push POSTs to the stored endpoint, so only accept a real push URL.
    IF p_endpoint !~ '^https://' OR length(p_endpoint) > 2048
       OR length(p_p256dh) > 256 OR length(p_auth) > 64 THEN
        RETURN FALSE;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM squares
        WHERE party_id = p_party_id
          AND player_name_lower = LOWER(TRIM(p_player_name))
    ) THEN
        RETURN FALSE;
    END IF;

    -- One save per party at a time: keeps the 200-row cap exact and the
    -- update-then-insert below free of duplicate-key races.
    PERFORM 1 FROM parties WHERE id = p_party_id FOR UPDATE;

    -- Refresh an existing device first: the 200-per-party limit trigger fires
    -- before ON CONFLICT is resolved, so an upsert would block refreshes at the cap.
    UPDATE push_subscriptions
    SET player_name = TRIM(p_player_name), p256dh = p_p256dh, auth = p_auth
    WHERE party_id = p_party_id AND endpoint = p_endpoint;
    IF FOUND THEN
        RETURN TRUE;
    END IF;

    INSERT INTO push_subscriptions (party_id, player_name, endpoint, p256dh, auth)
    VALUES (p_party_id, TRIM(p_player_name), p_endpoint, p_p256dh, p_auth);

    RETURN TRUE;
END;
$$;


ALTER FUNCTION "public"."save_push_subscription"("p_party_id" "uuid", "p_player_name" character varying, "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_home_team_side"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
DECLARE
    v_side BOOLEAN;
BEGIN
    IF NEW.game_id IS NOT NULL THEN
        SELECT game_side(NEW.team_row_name, NEW.team_col_name, g) INTO v_side
        FROM game_scores g WHERE g.game_id = NEW.game_id;
        NEW.home_team_is_row := COALESCE(v_side, NEW.home_team_is_row);
    END IF;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_home_team_side"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."splits_valid"("p_q1" integer, "p_q2" integer, "p_q3" integer, "p_final" integer) RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
    SELECT p_q1 IS NOT NULL AND p_q2 IS NOT NULL AND p_q3 IS NOT NULL AND p_final IS NOT NULL
       AND LEAST(p_q1, p_q2, p_q3, p_final) >= 0
       AND GREATEST(p_q1, p_q2, p_q3, p_final) <= 100
       AND p_q1 + p_q2 + p_q3 + p_final = 100;
$$;


ALTER FUNCTION "public"."splits_valid"("p_q1" integer, "p_q2" integer, "p_q3" integer, "p_final" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_linked_home_team_side"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
    UPDATE parties p
    SET home_team_is_row = game_side(p.team_row_name, p.team_col_name, NEW)
    WHERE p.game_id = NEW.game_id
      AND game_side(p.team_row_name, p.team_col_name, NEW) IS NOT NULL
      AND game_side(p.team_row_name, p.team_col_name, NEW) IS DISTINCT FROM p.home_team_is_row;
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_linked_home_team_side"() OWNER TO "postgres";


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


CREATE OR REPLACE FUNCTION "public"."update_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."update_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_type" character varying(50) NOT NULL,
    "party_id" "uuid",
    "details" "jsonb",
    "ip_address" "inet",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."audit_log" OWNER TO "postgres";


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
    "amount" numeric(14,2) NOT NULL,
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



CREATE INDEX "idx_parties_expires" ON "public"."parties" USING "btree" ("expires_at");



CREATE INDEX "idx_parties_game_id" ON "public"."parties" USING "btree" ("game_id");



CREATE INDEX "idx_push_subscriptions_party_player" ON "public"."push_subscriptions" USING "btree" ("party_id", "player_name_lower");



CREATE OR REPLACE TRIGGER "enforce_push_subscription_limit" BEFORE INSERT ON "public"."push_subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."check_push_subscription_limit"();



CREATE OR REPLACE TRIGGER "game_scores_a_home_team_side" AFTER INSERT OR UPDATE OF "home_team_name", "away_team_name", "home_team_abbrev", "away_team_abbrev" ON "public"."game_scores" FOR EACH ROW EXECUTE FUNCTION "public"."sync_linked_home_team_side"();



CREATE OR REPLACE TRIGGER "game_scores_propagate" AFTER INSERT OR UPDATE ON "public"."game_scores" FOR EACH ROW EXECUTE FUNCTION "public"."propagate_game_scores"();



CREATE OR REPLACE TRIGGER "parties_home_team_side" BEFORE INSERT OR UPDATE OF "game_id", "team_row_name", "team_col_name" ON "public"."parties" FOR EACH ROW EXECUTE FUNCTION "public"."set_home_team_side"();



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



CREATE POLICY "Anyone can read numbers" ON "public"."numbers" FOR SELECT USING (true);



CREATE POLICY "Anyone can read parties" ON "public"."parties" FOR SELECT USING (true);



CREATE POLICY "Anyone can read scores" ON "public"."scores" FOR SELECT USING (true);



CREATE POLICY "Anyone can read squares" ON "public"."squares" FOR SELECT USING (true);



CREATE POLICY "Anyone can read winners" ON "public"."winners" FOR SELECT USING (true);



CREATE POLICY "Service role can read subscriptions" ON "public"."push_subscriptions" FOR SELECT TO "service_role" USING (true);



CREATE POLICY "Service role only" ON "public"."audit_log" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."audit_log" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."game_scores" ENABLE ROW LEVEL SECURITY;


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































































































































































GRANT SELECT ON TABLE "public"."game_scores" TO "anon";
GRANT SELECT ON TABLE "public"."game_scores" TO "authenticated";
GRANT ALL ON TABLE "public"."game_scores" TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_game_scores"("p_party_id" "uuid", "p_home_is_row" boolean, "p_new" "public"."game_scores", "p_old" "public"."game_scores") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_game_scores"("p_party_id" "uuid", "p_home_is_row" boolean, "p_new" "public"."game_scores", "p_old" "public"."game_scores") TO "service_role";



REVOKE ALL ON FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."auto_update_score"("p_party_id" "uuid", "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."backfill_party_scores"("p_party_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_push_subscription_limit"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_push_subscription_limit"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_squares"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_squares"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") TO "service_role";
GRANT ALL ON FUNCTION "public"."claim_squares"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."claim_squares"("p_party_id" "uuid", "p_player_name" character varying, "p_cells" "jsonb") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."game_side"("p_row_name" "text", "p_col_name" "text", "p_game" "public"."game_scores") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."game_side"("p_row_name" "text", "p_col_name" "text", "p_game" "public"."game_scores") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_party_preview"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_party_preview"("p_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_party_preview"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_party_preview"("p_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."get_party_state"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_party_state"("p_code" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."get_party_state"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_party_state"("p_code" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."host_create_party"("p_host_name" character varying, "p_pin" character varying, "p_square_price" numeric, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_delete_party"("p_party_id" "uuid", "p_pin" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_delete_party"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_delete_party"("p_party_id" "uuid", "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."host_delete_party"("p_party_id" "uuid", "p_pin" character varying) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_gate"("p_party_id" "uuid", "p_pin" character varying, "p_action" "text", "p_required_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_gate"("p_party_id" "uuid", "p_pin" character varying, "p_action" "text", "p_required_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."host_lock_party"("p_party_id" "uuid", "p_pin" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_lock_party"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_lock_party"("p_party_id" "uuid", "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."host_lock_party"("p_party_id" "uuid", "p_pin" character varying) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_pin_check"("p_party_id" "uuid", "p_pin" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_pin_check"("p_party_id" "uuid", "p_pin" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."host_record_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_record_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_record_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."host_record_score"("p_party_id" "uuid", "p_pin" character varying, "p_quarter" character varying, "p_row_score" integer, "p_col_score" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_refusal"("p_party_id" "uuid", "p_action" "text", "p_error" "text", "p_field" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_refusal"("p_party_id" "uuid", "p_action" "text", "p_error" "text", "p_field" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."host_remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name" character varying) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."host_remove_player"("p_party_id" "uuid", "p_pin" character varying, "p_player_name" character varying) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_update_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_update_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_update_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."host_update_details"("p_party_id" "uuid", "p_pin" character varying, "p_event_name" character varying, "p_kickoff_at" timestamp with time zone, "p_team_row_name" character varying, "p_team_col_name" character varying, "p_team_row_color" character varying, "p_team_col_color" character varying) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_update_payouts"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_update_payouts"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_update_payouts"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."host_update_payouts"("p_party_id" "uuid", "p_pin" character varying, "p_split_q1" integer, "p_split_q2" integer, "p_split_q3" integer, "p_split_final" integer) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."host_verify_pin"("p_party_code" character varying, "p_pin" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."host_verify_pin"("p_party_code" character varying, "p_pin" character varying) TO "service_role";
GRANT ALL ON FUNCTION "public"."host_verify_pin"("p_party_code" character varying, "p_pin" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."host_verify_pin"("p_party_code" character varying, "p_pin" character varying) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."log_audit_event"("p_event_type" character varying, "p_party_id" "uuid", "p_details" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."party_details_problem"("p_event_name" "text", "p_team_row_name" "text", "p_team_col_name" "text", "p_team_row_color" "text", "p_team_col_color" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."party_details_problem"("p_event_name" "text", "p_team_row_name" "text", "p_team_col_name" "text", "p_team_row_color" "text", "p_team_col_color" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."party_expiry"("p_kickoff_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."party_expiry"("p_kickoff_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."propagate_game_scores"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."propagate_game_scores"() TO "service_role";



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



REVOKE ALL ON FUNCTION "public"."public_party_json"("p_party" "public"."parties") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."public_party_json"("p_party" "public"."parties") TO "service_role";



REVOKE ALL ON FUNCTION "public"."record_quarter_score"("p_party_id" "uuid", "p_quarter" "text", "p_row_score" integer, "p_col_score" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."record_quarter_score"("p_party_id" "uuid", "p_quarter" "text", "p_row_score" integer, "p_col_score" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."save_push_subscription"("p_party_id" "uuid", "p_player_name" character varying, "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."save_push_subscription"("p_party_id" "uuid", "p_player_name" character varying, "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text") TO "service_role";
GRANT ALL ON FUNCTION "public"."save_push_subscription"("p_party_id" "uuid", "p_player_name" character varying, "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."save_push_subscription"("p_party_id" "uuid", "p_player_name" character varying, "p_endpoint" "text", "p_p256dh" "text", "p_auth" "text") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."set_home_team_side"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_home_team_side"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."splits_valid"("p_q1" integer, "p_q2" integer, "p_q3" integer, "p_final" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."splits_valid"("p_q1" integer, "p_q2" integer, "p_q3" integer, "p_final" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_linked_home_team_side"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_linked_home_team_side"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "anon";
GRANT ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "authenticated";
GRANT ALL ON FUNCTION "public"."unclaim_square"("p_party_id" "uuid", "p_row" integer, "p_col" integer, "p_player_name" character varying) TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."audit_log" TO "service_role";



GRANT SELECT ON TABLE "public"."numbers" TO "anon";
GRANT SELECT ON TABLE "public"."numbers" TO "authenticated";
GRANT ALL ON TABLE "public"."numbers" TO "service_role";



GRANT ALL ON TABLE "public"."push_subscriptions" TO "service_role";



GRANT SELECT ON TABLE "public"."scores" TO "anon";
GRANT SELECT ON TABLE "public"."scores" TO "authenticated";
GRANT ALL ON TABLE "public"."scores" TO "service_role";



GRANT SELECT ON TABLE "public"."squares" TO "anon";
GRANT SELECT ON TABLE "public"."squares" TO "authenticated";
GRANT ALL ON TABLE "public"."squares" TO "service_role";



GRANT SELECT ON TABLE "public"."winners" TO "anon";
GRANT SELECT ON TABLE "public"."winners" TO "authenticated";
GRANT ALL ON TABLE "public"."winners" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" REVOKE ALL ON FUNCTIONS FROM PUBLIC;




























