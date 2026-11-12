-- 044: A quarter's winnings fit for every square price the app accepts.
--
-- party_details_problem accepts square prices up to (but not including) 100,000,000, and
-- record_quarter_score stores price x 100 squares x split% in winners.amount. As
-- NUMERIC(10,2) the column topped out at 99,999,999.99, so from about 1,000,000 a square
-- (100% split) or 4,000,000 (25%) recording a score raised "numeric field overflow": the
-- host's score failed and the live trigger skipped the party. NUMERIC(14,2) holds the
-- largest possible payout (99,999,999.99 x 100). Widening the precision at the same
-- scale changes no stored value.

ALTER TABLE public.winners ALTER COLUMN amount TYPE NUMERIC(14, 2);
