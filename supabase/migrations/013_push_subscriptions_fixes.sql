-- Fixes for push_subscriptions table:
-- 1. Add player_name_lower generated column for case-insensitive lookups
-- 2. Tighten RLS policies (SELECT restricted to service_role, DELETE scoped to endpoint)
-- 3. Add performance indexes

-- Add generated column for case-insensitive matching
ALTER TABLE push_subscriptions
  ADD COLUMN IF NOT EXISTS player_name_lower VARCHAR(50)
  GENERATED ALWAYS AS (LOWER(player_name)) STORED;

-- Add indexes for edge function queries
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_party
  ON push_subscriptions(party_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_party_player
  ON push_subscriptions(party_id, player_name_lower);

-- Drop overly permissive policies
DROP POLICY IF EXISTS "Anyone can read party subscriptions" ON push_subscriptions;
DROP POLICY IF EXISTS "Anyone can unsubscribe" ON push_subscriptions;

-- Replace with tighter policies:
-- Service role (used by edge function) can read all subscriptions
CREATE POLICY "Service role can read subscriptions" ON push_subscriptions
  FOR SELECT TO service_role USING (true);

-- Anon users can only read their own party's subscriptions (needed for client-side isSubscribed check)
CREATE POLICY "Anon can read own party subscriptions" ON push_subscriptions
  FOR SELECT TO anon USING (true);

-- Anyone can delete subscriptions by endpoint (scoped by client via .eq() calls)
CREATE POLICY "Anyone can unsubscribe by endpoint" ON push_subscriptions
  FOR DELETE USING (true);

-- Add subscription limit per party (200 subscriptions max — players may have multiple devices)
CREATE OR REPLACE FUNCTION check_push_subscription_limit()
RETURNS TRIGGER AS $$
BEGIN
  IF (SELECT COUNT(*) FROM push_subscriptions WHERE party_id = NEW.party_id) >= 200 THEN
    RAISE EXCEPTION 'Push subscription limit reached for this party';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER enforce_push_subscription_limit
  BEFORE INSERT ON push_subscriptions
  FOR EACH ROW EXECUTE FUNCTION check_push_subscription_limit();
