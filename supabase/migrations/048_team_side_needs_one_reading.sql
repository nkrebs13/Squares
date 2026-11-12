-- game_side: a party's teams name the game's home team only when they fit one way round.
--
-- Matching is loose (either name contains the other, or the abbreviation is equal), so a
-- short or shared name can fit both game teams. When one name fits both and the other
-- fits one, the side is still known by elimination, and that answer stays. When both
-- orientations fit (each name fits both teams, or the names fit crosswise both ways),
-- the old CASE took the first branch and guessed home = row; the live trigger would then
-- score the wrong square and pay the wrong player. It now returns NULL, which every
-- caller already treats as "unknown" (the stored flag is left as it was).

CREATE OR REPLACE FUNCTION public.game_side(p_row_name text, p_col_name text, p_game public.game_scores)
RETURNS boolean
LANGUAGE sql IMMUTABLE
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
    ),
    o AS (
        SELECT (row_home AND col_away) AS row_is_home,
               (row_away AND col_home) AS row_is_away
        FROM m
    )
    SELECT CASE
        WHEN row_is_home AND NOT row_is_away THEN TRUE
        WHEN row_is_away AND NOT row_is_home THEN FALSE
    END
    FROM o;
$$;
