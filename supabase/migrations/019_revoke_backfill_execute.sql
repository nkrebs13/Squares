-- ============================================================
-- 019: Revoke public execute on backfill_party_scores
--
-- Security hardening: This SECURITY DEFINER function should
-- only be callable by service role (admin), not public.
-- ============================================================

REVOKE EXECUTE ON FUNCTION backfill_party_scores(UUID) FROM PUBLIC;
