-- 105_online_signup_errors.sql
-- Per-step error log linked to online_signups. Useful for the admin "Signups"
-- page when a row's status is 'failed' and we want to see why.
-- request_payload + error_payload MUST be redacted of any PayPage transaction
-- IDs by the caller before insertion — we never persist payment tokens.

CREATE TABLE IF NOT EXISTS online_signup_errors (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signup_id       UUID REFERENCES online_signups(id) ON DELETE CASCADE,
  step            TEXT NOT NULL,             -- 'eligibility' | 'start' | 'submit' | 'fanout' | etc.
  error_type      TEXT,                       -- machine-readable category
  error_message   TEXT,                       -- human-readable summary
  error_payload   JSONB,                      -- ABC / GHL / Meta response body
  request_payload JSONB,                      -- our outbound request (redacted)
  occurred_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_online_signup_errors_signup
  ON online_signup_errors(signup_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_online_signup_errors_step
  ON online_signup_errors(step, occurred_at DESC);
