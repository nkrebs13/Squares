# Game Day Operations

## Monitoring

- **Supabase Dashboard**: Monitor error rates, Realtime connections, and database load
- Supabase Realtime connection limit: check your plan tier (free tier: 200 concurrent)
- For 20-50 concurrent users: should be well within limits

## Common Issues

### Scores not updating in real-time

1. Check Supabase Realtime is enabled for the `scores` and `winners` tables
2. Verify the PWA service worker isn't caching RPC responses (RPCs now use NetworkOnly)
3. Have users hard-refresh: pull-to-refresh on mobile or Ctrl+Shift+R on desktop

### Party stuck in wrong state

Use the Supabase SQL Editor:

```sql
-- Check party status
SELECT id, code, status FROM parties WHERE code = 'XXXXXX';

-- Force party to active (after verifying numbers exist)
UPDATE parties SET status = 'active' WHERE code = 'XXXXXX';

-- Force party to complete
UPDATE parties SET status = 'complete' WHERE code = 'XXXXXX';
```

### Missing winner records

If `update_score` RPC fails, manually insert winners:

```sql
-- Find the party and its numbers
SELECT p.id, n.row_numbers, n.col_numbers
FROM parties p JOIN numbers n ON p.id = n.party_id
WHERE p.code = 'XXXXXX';

-- Find winning square (example: Q1 score row=14, col=7)
-- Digit = score % 10, so row_digit=4, col_digit=7
-- winning_row = position of 4 in row_numbers (0-indexed)
-- winning_col = position of 7 in col_numbers (0-indexed)

-- Insert winner manually
INSERT INTO winners (party_id, quarter, winning_row, winning_col, player_name, amount)
SELECT
  p.id,
  'q1',
  winning_row,
  winning_col,
  s.player_name,
  p.square_price * 100 * p.split_q1 / 100
FROM parties p
JOIN squares s ON s.party_id = p.id
  AND s.row_num = winning_row
  AND s.col_num = winning_col
WHERE p.code = 'XXXXXX';
```

### Clear service worker cache

Have users run in browser console:

```js
navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
location.reload();
```

### Check broadcast channel health

In browser console on the party page:

```js
// Check if realtime is connected
document.querySelectorAll('[class*="grid"]').length > 0 && console.log('Grid loaded');
```

## Emergency Contacts

- Supabase status: https://status.supabase.com
- Cloudflare status: https://www.cloudflarestatus.com
