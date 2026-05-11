-- 100_online_join_locations.sql
-- One row per WCS location. The widget reads everything it needs from this
-- row + the join with online_join_plans / age_rules / copy. Editable from
-- the admin UI without touching code.

CREATE TABLE IF NOT EXISTS online_join_locations (
  wcs_location_id      TEXT PRIMARY KEY,        -- 'medford', 'salem', etc.
  display_name         TEXT NOT NULL,           -- 'WCS Medford'
  address_line1        TEXT,
  address_line2        TEXT,
  city                 TEXT,
  state                TEXT,
  zip                  TEXT,
  phone                TEXT,
  hours_summary        TEXT,
  day_one_booking_url  TEXT,
  hero_headline        TEXT,
  hero_subhead         TEXT,
  ghl_location_id      TEXT NOT NULL,           -- maps to existing GHL config
  abc_club_number      TEXT NOT NULL,           -- maps to existing ABC config
  active               BOOLEAN DEFAULT true,
  updated_at           TIMESTAMPTZ DEFAULT now(),
  updated_by           TEXT                     -- staff user ID who last edited
);

CREATE INDEX IF NOT EXISTS idx_online_join_locations_active
  ON online_join_locations(active) WHERE active = true;
