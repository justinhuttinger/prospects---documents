-- ACH variant of each online-join plan. ABC requires a separate
-- paymentPlanId for ACH vs Credit Card; the ACH version typically has
-- $5/mo lower dues because the convenience-fee profit-center isn't
-- attached. All three columns are nullable — if absent, /start falls
-- back to the CC values stored in the existing columns.

ALTER TABLE online_join_plans
  ADD COLUMN IF NOT EXISTS payment_plan_id_ach text,
  ADD COLUMN IF NOT EXISTS today_amount_ach numeric(10,2),
  ADD COLUMN IF NOT EXISTS monthly_amount_ach numeric(10,2);

COMMENT ON COLUMN online_join_plans.payment_plan_id_ach IS
  'ABC paymentPlanId for the ACH/EFT variant of this plan. /start uses this when payment_method_choice=ach. NULL falls back to payment_plan_id.';
COMMENT ON COLUMN online_join_plans.today_amount_ach IS
  'Due-today amount for the ACH variant. NULL falls back to today_amount.';
COMMENT ON COLUMN online_join_plans.monthly_amount_ach IS
  'Monthly dues for the ACH variant (typically CC price minus the convenience fee). NULL falls back to monthly_amount.';
