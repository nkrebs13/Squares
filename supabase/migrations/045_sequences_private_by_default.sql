-- 045: Sequences are private by default, like tables (042) and functions (034).
--
-- 042 revoked the browser roles' default privileges on new tables but not on new
-- sequences: every sequence created in public (a serial or identity column) still gave
-- anon and authenticated USAGE, SELECT and UPDATE, so a browser could nextval or setval
-- it. No public sequence exists today; this closes it before the first one does.
-- Browsers never write tables directly, so they never need a sequence.

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
	REVOKE ALL ON SEQUENCES FROM anon, authenticated;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
