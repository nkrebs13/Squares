-- Restrict audit_log RLS: revoke anon read access.
--
-- Migration 007 created a policy FOR ALL USING (true) which grants the
-- anon key SELECT access to all audit events (player names, timestamps,
-- every claim/unclaim/score update). The app never reads audit_log from
-- the client, so anon SELECT is unintended and a privacy exposure.
--
-- Replace with service_role-only access. The postgres superuser and
-- service_role key retain full access; the anon key is denied.

DROP POLICY IF EXISTS "Service role can do anything" ON audit_log;

CREATE POLICY "Service role only" ON audit_log
    FOR ALL TO service_role USING (true) WITH CHECK (true);
