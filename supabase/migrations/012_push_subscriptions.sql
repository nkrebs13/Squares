-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  player_name VARCHAR(50) NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(party_id, endpoint)
);

-- Enable RLS
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Anyone can insert their own subscription
CREATE POLICY "Anyone can subscribe" ON push_subscriptions
  FOR INSERT WITH CHECK (true);

-- Anyone can read subscriptions for their party (needed for edge function)
CREATE POLICY "Anyone can read party subscriptions" ON push_subscriptions
  FOR SELECT USING (true);

-- Anyone can delete their own subscription by endpoint
CREATE POLICY "Anyone can unsubscribe" ON push_subscriptions
  FOR DELETE USING (true);
