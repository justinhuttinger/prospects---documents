-- 115_online_join_prorated_billing.sql
-- Per-club flag for ABC prorated billing (e.g. Clackamas/Milwaukie prorate dues
-- to a fixed due day, so the "due today" amount is a prorated partial-month that
-- changes daily). When true, the join widget shows ABC's live, date-aware
-- `downPaymentTotalAmount` (fetched at /start from GET /clubs/plans/{id}) as the
-- due-today figure instead of the static DB value. Clubs without this flag are
-- unaffected — they keep their stored today_amount display.
--
-- NOTE: this is display-only. ABC always computes + charges the correct amount
-- regardless of this flag; it just controls which number we SHOW the member.

ALTER TABLE online_join_locations
  ADD COLUMN IF NOT EXISTS prorated_billing BOOLEAN DEFAULT false;

UPDATE online_join_locations SET prorated_billing = true
  WHERE wcs_location_id IN ('clackamas', 'milwaukie');

COMMENT ON COLUMN online_join_locations.prorated_billing IS
  'When true, the widget displays ABC''s live downPaymentTotalAmount (prorated due-today) on the Review/Welcome steps instead of the static today_amount. Display-only.';
