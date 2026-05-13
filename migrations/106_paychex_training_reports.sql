-- Paychex Training — one row per webhook delivery.
--
-- Paychex Flex Learning can be configured to push a "Transcript" report
-- (zip of CSVs, with `dashboard-transcript/learner_transcript.csv` as the
-- payload of interest) to a webhook URL on a schedule. Each delivery is
-- recorded here so we have an audit trail of when data refreshed and what
-- the parser saw.

create table if not exists paychex_training_reports (
  id              uuid primary key default gen_random_uuid(),
  received_at     timestamptz not null default now(),
  source          text not null default 'webhook',  -- 'webhook' | 'manual_upload'
  file_name       text,
  file_size_bytes bigint,
  record_count    integer not null default 0,
  parse_status    text not null default 'pending',  -- 'pending' | 'success' | 'partial' | 'failed'
  parse_error     text,
  account_name    text,
  raw_zip_path    text,                              -- optional Supabase Storage path for the original zip
  raw_csv_path    text                               -- optional Supabase Storage path for the extracted CSV
);

create index if not exists idx_paychex_training_reports_received_at
  on paychex_training_reports (received_at desc);
