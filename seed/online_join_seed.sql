-- online_join_seed.sql
-- Idempotent seed for the WCS Online Join data model. Re-run anytime.
-- After applying migrations 100-105, run this in Supabase SQL editor.
--
-- What this DOES populate:
--   - All 7 locations with their abc_club_number and ghl_location_id.
--   - One "Adult (18+)" age rule.
--   - The default copy keys (already in migration 103, but harmless to re-run).
--
-- What this does NOT populate (admin will fill in via the staff portal UI):
--   - Plans — placeholder ABC IDs are not safe; spec §13 lists these as
--     "confirm with ABC" items. Add plans manually via the admin UI once
--     real paymentPlanId / planValidationHash values land.
--   - Real per-location addresses, phones, hours, day-one URLs, hero copy —
--     leaving as NULL so admin sees empty fields to fill in (intentional
--     "edit me" prompt).
--
-- GHL location IDs are taken from env vars consumed by ghl-sync; if any of
-- these change, edit the rows here OR via the admin UI (admin UI wins for
-- runtime values).

-- ---------------------------------------------------------------------------
-- 7 Locations
-- ---------------------------------------------------------------------------
INSERT INTO online_join_locations (wcs_location_id, display_name, abc_club_number, ghl_location_id)
VALUES
  ('salem',       'WCS Salem',       '30935', ''),
  ('keizer',      'WCS Keizer',      '31599', ''),
  ('eugene',      'WCS Eugene',      '7655',  ''),
  ('springfield', 'WCS Springfield', '31598', ''),
  ('clackamas',   'WCS Clackamas',   '31600', ''),
  ('milwaukie',   'WCS Milwaukie',   '31601', ''),
  ('medford',     'WCS Medford',     '32073', '')
ON CONFLICT (wcs_location_id) DO NOTHING;

-- NOTE: ghl_location_id is left blank above because the values are
-- environment-driven on the staff portal side. Run the UPDATEs below after
-- pulling them from `ghl-sync/.env` (GHL_LOCATION_SALEM, etc.). Or, edit
-- them per-location from the staff portal admin UI once that ships.
--
-- Example:
--   UPDATE online_join_locations SET ghl_location_id = '<value>' WHERE wcs_location_id = 'salem';

-- ---------------------------------------------------------------------------
-- Base age rule — Adult 18+
-- ---------------------------------------------------------------------------
INSERT INTO online_join_age_rules (name, min_age, max_age, ineligible_message)
VALUES (
  'Adult',
  18,
  NULL,
  'This membership is for adults 18 and over. If you''re under 18, please choose a Youth plan or contact us at the gym.'
)
ON CONFLICT (name) DO NOTHING;
