-- Paychex Training — one row per (user, learnable) enrollment.
--
-- Columns mirror `learner_transcript.csv` from the Paychex Flex Learning
-- Transcript export. The natural key is (user_id, learnable_id): Paychex
-- carries one transcript line per learner-enrollment, even for re-enrollments
-- (those bump `re_enrollment_date` rather than create a new row).
--
-- Every upsert sets `last_report_id` and `last_seen_at`. Records whose
-- `last_report_id` is older than the most recent paychex_training_reports
-- row are "no longer present in the latest export" — useful for spotting
-- users who were removed from the LMS or had their enrollment dropped.

create table if not exists paychex_training_records (
  id                            uuid primary key default gen_random_uuid(),
  user_id                       text not null,
  learnable_id                  text not null,

  -- Learner ----------------------------------------------------------------
  user_name                     text,
  email                         text,
  uid                           text,            -- Paychex long-form UID
  hris_id                       text,
  manager_name                  text,
  manager_email                 text,
  manager_uid                   text,
  user_deleted                  boolean not null default false,

  -- Learnable --------------------------------------------------------------
  title                         text,
  learnable_type                text,            -- 'Course' | 'Live Training' | 'Program' | 'Checkpoint' | ...
  program_ids                   text,            -- comma-separated Paychex program IDs
  program_titles                text,

  -- Status -----------------------------------------------------------------
  status                        text,            -- 'Completed' | 'In Progress' | 'Overdue' | 'Not Started' | etc.
  required                      boolean,
  score                         numeric,
  continuing_education_credits  numeric,
  certificate_link              text,

  -- Dates ------------------------------------------------------------------
  enrollment_date               date,
  due_date                      date,
  completion_date               date,
  expiration_date               date,
  re_enrollment_date            date,
  modification_date             date,

  -- Context ----------------------------------------------------------------
  account_name                  text,            -- Paychex legal entity (e.g. "West Coast Strength LLC")
  subscription_end_date         date,

  -- Audit ------------------------------------------------------------------
  last_report_id                uuid references paychex_training_reports(id) on delete set null,
  last_seen_at                  timestamptz not null default now(),
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now(),
  raw                           jsonb,           -- full CSV row keyed by header

  unique (user_id, learnable_id)
);

create index if not exists idx_paychex_training_records_email
  on paychex_training_records (email);
create index if not exists idx_paychex_training_records_status
  on paychex_training_records (status);
create index if not exists idx_paychex_training_records_required_status
  on paychex_training_records (required, status);
create index if not exists idx_paychex_training_records_manager_email
  on paychex_training_records (manager_email);
create index if not exists idx_paychex_training_records_last_report_id
  on paychex_training_records (last_report_id);
