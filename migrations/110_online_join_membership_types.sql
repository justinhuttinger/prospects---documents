-- 110_online_join_membership_types.sql
-- Online Join v2: introduce a normalized "membership type" layer above plans.
--
-- A type ("Single", "Family", "Youth") owns the amenities + eligibility and is
-- what the member picks on step 2. Each type has up to two child plans — one
-- per term ('1yr' / 'm2m') — which carry the ABC paymentPlanId + pricing +
-- enrollment fee (unchanged from before). Amenities move from the per-plan
-- features[] up to the type, so the 1-Year and M2M of the same type share one
-- amenity list (no drift).
--
-- Promo support: a type with a promo_code is hidden from the public config
-- UNLESS the widget passes ?promo=<code> and (now) falls inside the optional
-- [promo_starts_at, promo_ends_at] window. Normal types have promo_code NULL
-- and are always visible.

CREATE TABLE IF NOT EXISTS online_join_membership_types (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wcs_location_id   TEXT NOT NULL REFERENCES online_join_locations(wcs_location_id),
  type_key          TEXT NOT NULL,                 -- 'single', 'family', 'youth'
  type_label        TEXT NOT NULL,                 -- 'Single Membership'
  description       TEXT,                          -- short marketing copy
  features          JSONB DEFAULT '[]'::jsonb,     -- amenities — single source of truth
  badge             TEXT,                          -- 'Most Popular', null

  age_rule_id       UUID REFERENCES online_join_age_rules(id),

  display_order     INT DEFAULT 0,

  -- Promo gating (all NULL = a normal, always-visible type)
  promo_code        TEXT,                          -- unlock code passed via ?promo=
  promo_starts_at   TIMESTAMPTZ,                   -- inclusive; NULL = no lower bound
  promo_ends_at     TIMESTAMPTZ,                   -- inclusive; NULL = no upper bound

  active            BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now(),
  updated_by        TEXT,

  UNIQUE(wcs_location_id, type_key)
);

CREATE INDEX IF NOT EXISTS idx_online_join_types_location
  ON online_join_membership_types(wcs_location_id, active);

CREATE INDEX IF NOT EXISTS idx_online_join_types_promo
  ON online_join_membership_types(promo_code) WHERE promo_code IS NOT NULL;

-- All portal DB access is service-role; enable RLS with no policy to match the
-- rest of the public schema (see the 59-table RLS sweep).
ALTER TABLE online_join_membership_types ENABLE ROW LEVEL SECURITY;

-- Plans become children of a type + carry a term. Both nullable so existing
-- rows survive the migration; the admin UI assigns them. The widget/config
-- only surface plans that have a membership_type_id + term set.
ALTER TABLE online_join_plans
  ADD COLUMN IF NOT EXISTS membership_type_id UUID REFERENCES online_join_membership_types(id),
  ADD COLUMN IF NOT EXISTS term TEXT;             -- '1yr' | 'm2m'

CREATE INDEX IF NOT EXISTS idx_online_join_plans_type
  ON online_join_plans(membership_type_id) WHERE membership_type_id IS NOT NULL;

COMMENT ON COLUMN online_join_plans.membership_type_id IS
  'FK to online_join_membership_types. The type owns amenities + eligibility; the plan owns ABC IDs + pricing for one term.';
COMMENT ON COLUMN online_join_plans.term IS
  'Membership term for this plan: "1yr" (12-month) or "m2m" (month-to-month). One plan per (type, term).';
COMMENT ON COLUMN online_join_plans.features IS
  'DEPRECATED in v2 — amenities now live on online_join_membership_types.features. Column retained for back-compat; ignored by the public widget.';
