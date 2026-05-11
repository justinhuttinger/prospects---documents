-- 104_online_signups.sql
-- One row per signup attempt. Lifecycle:
--   started → payment_pending → submitted_to_abc → agreement_created
--   (or 'failed' at any stage)

CREATE TABLE IF NOT EXISTS online_signups (
  id                              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status                          TEXT NOT NULL DEFAULT 'started',

  wcs_location_id                 TEXT NOT NULL,
  plan_id                         UUID NOT NULL REFERENCES online_join_plans(id),
  payment_plan_id                 TEXT NOT NULL,   -- snapshot at signup time
  abc_club_number                 TEXT NOT NULL,

  -- Contact (collected on parent form)
  first_name                      TEXT,
  last_name                       TEXT,
  email                           TEXT,
  cell_phone                      TEXT,
  birthday                        DATE,
  gender                          TEXT,
  address_line1                   TEXT,
  address_line2                   TEXT,
  city                            TEXT,
  state                           TEXT,
  zip_code                        TEXT,
  emergency_contact               JSONB,

  -- Payment method choice (before PayPage)
  payment_method_choice           TEXT,            -- 'card' or 'ach'

  -- PayPage tokens (NEVER raw card data)
  paypage_today_transaction_id    TEXT,
  paypage_draft_transaction_id    TEXT,
  paypage_payment_type            TEXT,            -- 'Credit Card' or 'Bank Account'

  -- ABC response
  abc_member_id                   TEXT,
  abc_agreement_id                TEXT,
  abc_response                    JSONB,

  -- Fan-out
  ghl_contact_id                  TEXT,
  meta_capi_sent                  BOOLEAN DEFAULT false,
  confirmation_email_sent         BOOLEAN DEFAULT false,

  -- Attribution
  fbclid                          TEXT,
  fbp                             TEXT,
  client_ip                       TEXT,
  user_agent                      TEXT,
  utm_source                      TEXT,
  utm_medium                      TEXT,
  utm_campaign                    TEXT,

  -- Marketing prefs
  marketing_email                 BOOLEAN DEFAULT true,
  marketing_sms                   BOOLEAN DEFAULT true,

  started_at                      TIMESTAMPTZ DEFAULT now(),
  payment_at                      TIMESTAMPTZ,
  submitted_at                    TIMESTAMPTZ,
  completed_at                    TIMESTAMPTZ,

  CONSTRAINT online_signups_status_check CHECK (status IN (
    'started', 'payment_pending', 'submitted_to_abc',
    'agreement_created', 'failed'
  ))
);

CREATE INDEX IF NOT EXISTS idx_online_signups_status   ON online_signups(status);
CREATE INDEX IF NOT EXISTS idx_online_signups_started  ON online_signups(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_online_signups_email    ON online_signups(email);
CREATE INDEX IF NOT EXISTS idx_online_signups_location ON online_signups(wcs_location_id, started_at DESC);
