-- 112_online_join_secondary_members.sql
-- Family / household (secondary) members for Online Join.
--
-- ABC has no dynamic dues, so each household-size tier is its own ABC payment
-- plan (its dues = the combined total for that size). The base family plan
-- covers up to 3 total people (primary + 2); extra plans exist only for 4+.
-- `max_members` on a plan = total people that plan covers. Normal plans = 1.
--
-- The widget collects each secondary member's name / DOB / email / phone (the
-- address is inherited from the primary) and they're posted to ABC under one
-- agreement via the secondaryMembers[] array.

ALTER TABLE online_join_membership_types
  ADD COLUMN IF NOT EXISTS allow_secondary_members BOOLEAN DEFAULT false;

ALTER TABLE online_join_plans
  ADD COLUMN IF NOT EXISTS max_members INT DEFAULT 1;

ALTER TABLE online_signups
  ADD COLUMN IF NOT EXISTS secondary_members JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN online_join_membership_types.allow_secondary_members IS
  'When true, the join widget shows a Household Members step for this type.';
COMMENT ON COLUMN online_join_plans.max_members IS
  'Total people this plan covers (primary + secondaries). Normal plan = 1; family base = 3; extra tiers = 4, 5, ... The widget auto-selects the smallest tier whose max_members >= the household size.';
COMMENT ON COLUMN online_signups.secondary_members IS
  'Array of household members captured at signup: [{first_name,last_name,birthday(ISO),email,cell_phone}]. Address inherited from the primary. Posted to ABC as secondaryMembers[].';
