-- 043: One rule maps a game's quarter scores onto a party.
--
-- propagate_game_scores (live trigger) and backfill_party_scores (operator tool) each
-- carried the quarter list, the dynamic column lookup and the home/away -> row/col
-- mapping. They differ only in which quarters they apply: the trigger applies the ones
-- that just went from unscored to scored, the backfill every one already scored, which
-- is the same rule with no previous row. apply_game_scores holds it once.
-- parties.home_team_is_row is NOT NULL, so the COALESCE both kept is gone.
--
-- Also drops two indexes no query uses: nothing filters parties by host_name_lower, and
-- every squares lookup by player_name_lower also filters party_id, which the
-- (party_id, row_num, col_num) unique index serves.

CREATE FUNCTION public.apply_game_scores(
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
$$;

CREATE OR REPLACE FUNCTION public.propagate_game_scores()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

CREATE OR REPLACE FUNCTION public.backfill_party_scores(p_party_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
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

DROP INDEX IF EXISTS public.idx_parties_host_name;
DROP INDEX IF EXISTS public.idx_squares_player;
