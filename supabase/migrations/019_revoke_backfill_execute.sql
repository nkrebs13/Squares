-- ============================================================
-- 019: Revoke public execute on backfill_party_scores
--
-- NOTE: This REVOKE is also in migration 018. This migration
-- exists because 018 was pushed before the REVOKE was added,
-- and we needed to apply it to production. Running REVOKE
-- twice is idempotent and harmless.
-- ============================================================

REVOKE EXECUTE ON FUNCTION backfill_party_scores(UUID) FROM PUBLIC;
