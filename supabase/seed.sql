-- Demo party seed for fresh-fork first-run experience.
-- Run automatically by: supabase db reset
-- Party code: DEMO01, PIN: 0000
-- UUID 00000000-0000-0000-0000-000000000001 is reserved for this demo.

BEGIN;

-- Idempotency: delete existing demo party (cascades to squares and scores)
DELETE FROM parties WHERE id = '00000000-0000-0000-0000-000000000001';

-- Insert demo party
INSERT INTO parties (
  id, code, host_pin, host_name_lower,
  square_price, split_q1, split_q2, split_q3, split_final,
  status, team_row_name, team_col_name, team_row_color, team_col_color,
  expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  'DEMO01',
  '0000',
  'demo host',
  5.00, 15, 20, 25, 40,
  'filling',
  'Seahawks', 'Patriots', '#69BE28', '#C60C30',
  NOW() + INTERVAL '365 days'
);

-- Insert 100 squares (10x10 grid)
INSERT INTO squares (party_id, row_num, col_num)
SELECT '00000000-0000-0000-0000-000000000001', r, c
FROM generate_series(0, 9) r
CROSS JOIN generate_series(0, 9) c;

-- Claim ~30 squares for 4 demo players (player_name_lower is GENERATED ALWAYS AS -- never set it directly)
UPDATE squares SET player_name = 'Alex', claimed_at = NOW()
WHERE party_id = '00000000-0000-0000-0000-000000000001'
  AND (row_num, col_num) IN ((0,0),(0,3),(1,7),(2,4),(4,1),(5,8),(7,2),(9,5));

UPDATE squares SET player_name = 'Jamie', claimed_at = NOW()
WHERE party_id = '00000000-0000-0000-0000-000000000001'
  AND (row_num, col_num) IN ((0,5),(1,2),(2,9),(3,6),(5,3),(6,0),(8,4),(9,8));

UPDATE squares SET player_name = 'Riley', claimed_at = NOW()
WHERE party_id = '00000000-0000-0000-0000-000000000001'
  AND (row_num, col_num) IN ((0,8),(2,1),(3,4),(4,7),(6,5),(7,9),(8,2));

UPDATE squares SET player_name = 'Morgan', claimed_at = NOW()
WHERE party_id = '00000000-0000-0000-0000-000000000001'
  AND (row_num, col_num) IN ((1,5),(3,0),(4,9),(5,6),(6,3),(7,7),(9,1));

-- Insert empty scores row (all quarter columns are nullable)
INSERT INTO scores (party_id) VALUES ('00000000-0000-0000-0000-000000000001');

COMMIT;
