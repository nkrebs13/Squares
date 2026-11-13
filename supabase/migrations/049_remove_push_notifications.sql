-- Push notifications are removed (HB-2416). Browsers could subscribe, but nothing ever
-- sent: the send-push edge function was never deployed and no trigger called it, so
-- the opt-in promised alerts that never came. Production held 0 subscriptions.
-- Dropping the table takes its trigger, policy, indexes and grants with it.

DROP TABLE IF EXISTS public.push_subscriptions;
DROP FUNCTION IF EXISTS public.save_push_subscription(uuid, character varying, text, text, text);
DROP FUNCTION IF EXISTS public.check_push_subscription_limit();
