-- 118_online_signups_reviewing_status.sql
-- Add a 'reviewing' funnel status: the widget flips a signup to 'reviewing' (via
-- POST /api/online-join/progress) once PayPage tokenizes the billing and the
-- member reaches Review & Sign. This distinguishes a payment-form bounce
-- (payment_pending) from "entered billing but never signed/confirmed"
-- (reviewing), so admin can see where members actually drop off.

ALTER TABLE online_signups DROP CONSTRAINT IF EXISTS online_signups_status_check;
ALTER TABLE online_signups ADD CONSTRAINT online_signups_status_check
  CHECK (status = ANY (ARRAY[
    'started', 'payment_pending', 'reviewing',
    'submitted_to_abc', 'agreement_created', 'failed'
  ]::text[]));
