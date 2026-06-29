-- 119_online_join_type_promo_callout.sql
-- Per-type promo callout: a short red highlight shown under the price on the
-- membership card (e.g. "HALF OFF AND NO ENROLLMENT"). Toggleable so the text
-- can be kept but hidden. Primarily for promo types, but allowed on any type.

ALTER TABLE online_join_membership_types
  ADD COLUMN IF NOT EXISTS promo_callout TEXT,
  ADD COLUMN IF NOT EXISTS promo_callout_enabled BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN online_join_membership_types.promo_callout IS
  'Short highlight shown in a red box under the price on the membership card (e.g. "HALF OFF AND NO ENROLLMENT"). Only shown when promo_callout_enabled is true.';
COMMENT ON COLUMN online_join_membership_types.promo_callout_enabled IS
  'Toggle for promo_callout — when true (and text is set), the red callout box is shown on the membership card.';
