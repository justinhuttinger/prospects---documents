-- 113_online_signups_add_abc_request.sql
-- Diagnostics: store the exact ABC POST /members/agreements request body we send
-- (PayPage transaction IDs redacted) alongside the response. Lets us audit the
-- billing envelope after a signup — e.g. confirm an EFT agreement sent only
-- payPageDraftBankAccount and how the "due today" amount was (or wasn't) handled.

ALTER TABLE online_signups
  ADD COLUMN IF NOT EXISTS abc_request JSONB;

COMMENT ON COLUMN online_signups.abc_request IS
  'Redacted ABC agreement request body we sent (PayPage tokens stripped). Paired with abc_response for billing diagnostics.';
