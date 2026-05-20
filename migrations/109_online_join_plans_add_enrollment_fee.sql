-- Surface the enrollment fee separately on plan cards. Existing
-- today_amount already represents "total due today" (enrollment +
-- first-month dues + any other today charges). We're not removing
-- that — just adding a sibling column so the widget can show an
-- itemized breakdown of Enrollment / Monthly / Total Due Today.

ALTER TABLE online_join_plans
  ADD COLUMN IF NOT EXISTS enrollment_fee numeric(10,2);

COMMENT ON COLUMN online_join_plans.enrollment_fee IS
  'One-time enrollment fee charged at signup. Surfaced on the public plan card alongside monthly_amount and today_amount. NULL/0 hides the row from the breakdown.';
