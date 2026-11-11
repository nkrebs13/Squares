-- A party's public summary, for the join page and link previews.
--
-- The join preview fetched all 100 square rows to count the filled ones, the
-- join submit queried the party again for the host name, and the party page's
-- server load kept its own copy of the column list. get_party_preview returns
-- the public party row and the filled-square count in one call.

CREATE FUNCTION get_party_preview(p_code TEXT) RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
    SELECT jsonb_build_object(
        'party', public_party_json(p),
        'filled_count', (SELECT count(*) FROM squares s
                         WHERE s.party_id = p.id AND s.player_name IS NOT NULL)
    )
    FROM parties p
    WHERE p.code = upper(p_code);
$$;

GRANT EXECUTE ON FUNCTION get_party_preview(TEXT) TO anon, authenticated;
