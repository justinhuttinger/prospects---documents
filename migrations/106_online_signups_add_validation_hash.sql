-- Add plan_validation_hash to online_signups.
--
-- Per ABC's POST Create Agreement docs (rev 2025-08-12), the planValidation
-- hash can change daily for plans with dynamic due dates. We fetch it fresh
-- from ABC at /start and store it on the signup row so /submit can pass the
-- still-valid value back. The plan-level hash in online_join_plans becomes
-- a fallback only.

ALTER TABLE online_signups
  ADD COLUMN IF NOT EXISTS plan_validation_hash text;

COMMENT ON COLUMN online_signups.plan_validation_hash IS
  'Fresh planValidationHash fetched from ABC at /start time. ABC docs note this can rotate daily, so the stored online_join_plans.plan_validation_hash is a fallback only.';
