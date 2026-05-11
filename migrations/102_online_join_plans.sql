-- 102_online_join_plans.sql
-- One row per offered plan at a location. Marketing fields (label, description,
-- features, badge, prices) and ABC-side fields (paymentPlanId, planValidationHash,
-- campaignId, salesPersonId) live together but the public config endpoint only
-- exposes the marketing fields — ABC IDs stay server-side.

CREATE TABLE IF NOT EXISTS online_join_plans (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wcs_location_id       TEXT NOT NULL REFERENCES online_join_locations(wcs_location_id),
  plan_key              TEXT NOT NULL,         -- 'standard-monthly', 'youth-monthly', etc.

  -- Display
  plan_label            TEXT NOT NULL,         -- 'Standard Membership'
  plan_description      TEXT,                  -- short marketing copy
  features              JSONB DEFAULT '[]'::jsonb,
  badge                 TEXT,                  -- 'Most Popular', 'Best Value', null
  today_amount          NUMERIC(10,2) NOT NULL,
  monthly_amount        NUMERIC(10,2) NOT NULL,
  display_order         INT DEFAULT 0,

  -- ABC integration (server-side only, never returned to widget)
  payment_plan_id       TEXT NOT NULL,
  plan_validation_hash  TEXT NOT NULL,
  campaign_id           TEXT,
  sales_person_id       TEXT,

  -- Eligibility — nullable means no age restriction
  age_rule_id           UUID REFERENCES online_join_age_rules(id),

  active                BOOLEAN DEFAULT true,
  created_at            TIMESTAMPTZ DEFAULT now(),
  updated_at            TIMESTAMPTZ DEFAULT now(),
  updated_by            TEXT,

  UNIQUE(wcs_location_id, plan_key)
);

CREATE INDEX IF NOT EXISTS idx_online_join_plans_location
  ON online_join_plans(wcs_location_id, active);

CREATE INDEX IF NOT EXISTS idx_online_join_plans_age_rule
  ON online_join_plans(age_rule_id) WHERE age_rule_id IS NOT NULL;
