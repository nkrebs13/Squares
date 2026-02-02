-- Fix non-idempotent indexes from migration 007
-- These use DROP IF EXISTS + CREATE to ensure idempotency
DROP INDEX IF EXISTS idx_audit_log_party;
DROP INDEX IF EXISTS idx_audit_log_event;
DROP INDEX IF EXISTS idx_audit_log_created;
CREATE INDEX idx_audit_log_party ON audit_log(party_id);
CREATE INDEX idx_audit_log_event ON audit_log(event_type);
CREATE INDEX idx_audit_log_created ON audit_log(created_at);
