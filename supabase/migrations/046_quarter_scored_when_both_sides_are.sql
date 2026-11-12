-- 046: A game's quarter reaches a party once both of its scores are in.
--
-- apply_game_scores decided "this quarter was just scored" from the home column alone.
-- game_scores keeps qN_home and qN_away as separate nullable columns, so a feed that
-- writes them in two updates first called auto_update_score with a NULL away score
-- (refused), then saw old_home already set and skipped the quarter for good. The
-- quarter is now applied when both scores are present and were not both present
-- before: once, whichever order they arrive in. A row that sets both at once (every
-- path today) behaves as before; the backfill (no previous row) applies every quarter
-- with both scores.

CREATE OR REPLACE FUNCTION public.apply_game_scores(
	p_party_id UUID,
	p_home_is_row BOOLEAN,
	p_new public.game_scores,
	p_old public.game_scores
)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
DECLARE
	v_q TEXT;
	v_home INT;
	v_away INT;
	v_old_home INT;
	v_old_away INT;
BEGIN
	FOREACH v_q IN ARRAY ARRAY['q1', 'q2', 'q3', 'final'] LOOP
		EXECUTE format('SELECT ($1).%I, ($1).%I', v_q || '_home', v_q || '_away')
			INTO v_home, v_away USING p_new;
		EXECUTE format('SELECT ($1).%I, ($1).%I', v_q || '_home', v_q || '_away')
			INTO v_old_home, v_old_away USING p_old;

		IF v_home IS NOT NULL AND v_away IS NOT NULL
			AND (v_old_home IS NULL OR v_old_away IS NULL) THEN
			IF p_home_is_row THEN
				PERFORM auto_update_score(p_party_id, v_q, v_home, v_away);
			ELSE
				PERFORM auto_update_score(p_party_id, v_q, v_away, v_home);
			END IF;
		END IF;
	END LOOP;
END;
$$;
