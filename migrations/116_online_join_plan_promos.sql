-- 116_online_join_plan_promos.sql
-- Plan-level promos: a single payment plan can carry a promo code (+ optional
-- window). A plan with a promo_code is HIDDEN from normal browsing; when the
-- widget URL has ?promo=<code> that matches it (within the window), the flow
-- skips type + term selection and goes straight to that one plan.
-- (This is separate from type-level promos on online_join_membership_types.)

ALTER TABLE online_join_plans
  ADD COLUMN IF NOT EXISTS promo_code TEXT,
  ADD COLUMN IF NOT EXISTS promo_starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS promo_ends_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_online_join_plans_promo
  ON online_join_plans(promo_code) WHERE promo_code IS NOT NULL;

COMMENT ON COLUMN online_join_plans.promo_code IS
  'When set, this plan is hidden from normal browsing and only shown via ?promo=<code> (within promo_starts_at/promo_ends_at) — going straight to this single plan.';
