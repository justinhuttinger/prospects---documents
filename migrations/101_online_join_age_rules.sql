-- 101_online_join_age_rules.sql
-- Named age ranges. A plan references one age rule; multiple plans can share
-- the same rule (e.g. all Adult plans across all locations share 'Adult 18+').
-- min_age / max_age are inclusive; NULL means unbounded.

CREATE TABLE IF NOT EXISTS online_join_age_rules (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT NOT NULL UNIQUE,     -- 'Adult', 'Youth', 'Senior'
  min_age            INT,                       -- inclusive; NULL = no minimum
  max_age            INT,                       -- inclusive; NULL = no maximum
  ineligible_message TEXT NOT NULL,             -- shown to user if DOB falls outside
  active             BOOLEAN DEFAULT true,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),

  CONSTRAINT min_lte_max CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
);
