-- 117_online_signups_addon_schedules.sql
-- ABC's POST Create Agreement requires that any schedule flagged
-- defaultChecked=true AND addon=true in the plan detail be echoed back in the
-- request under `schedules.addon` (an array of the profit-center names, matched
-- case-sensitively against the Plan Detail response). Omitting them returns
-- API-MEM-MEM-0024 ("one or more schedules required by the payment plan are
-- missing from the request"). The classic case is a CC convenience fee that is
-- a separate recurring add-on line (Clackamas/Milwaukie WEB-*-CC plans).
--
-- We capture the exact `profitCenter` strings live at /start (same fetch as the
-- plan validation hash, so they stay consistent with the hashed plan snapshot)
-- and store them here, then buildAgreementPayload sends them verbatim.

ALTER TABLE online_signups
  ADD COLUMN IF NOT EXISTS abc_addon_schedules JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN online_signups.abc_addon_schedules IS
  'Profit-center names of defaultChecked add-on schedules (addon=true) captured from ABC plan detail at /start; sent verbatim in the agreement request as schedules.addon[] to satisfy API-MEM-MEM-0024.';
