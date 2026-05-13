-- Paychex HR → location resolution.
--
-- Each WCS gym is a separate Paychex Flex company. To filter the training
-- transcript by gym we periodically pull every Paychex Worker for each of
-- our 7 companies and persist (email, company_id, location_slug) here.
--
-- The /records endpoint LEFT JOINs paychex_training_records.email against
-- this table to surface a location_slug per training row. Missing matches
-- (staff with no Paychex HR record, third-party trainers, email mismatch)
-- bucket as "Unassigned" in the UI.
--
-- email is the join key (case-folded). One row per (lower(email), company_id);
-- a staff member who exists in two Paychex companies will produce two rows.

create table if not exists paychex_user_locations (
  id                  uuid primary key default gen_random_uuid(),
  email_lower         text not null,            -- lower(email) — join key
  email               text,                     -- preserved as-returned for display
  paychex_worker_id   text,                     -- Paychex Worker.workerId
  company_id          text not null,            -- Paychex companyId
  location_slug       text not null,            -- 'salem' | 'keizer' | ...
  display_id          text,                     -- Paychex displayId (employee number)
  first_name          text,
  last_name           text,
  worker_status       text,                     -- 'ACTIVE' | 'TERMINATED' | etc.
  refreshed_at        timestamptz not null default now(),
  unique (email_lower, company_id)
);

create index if not exists idx_paychex_user_locations_email
  on paychex_user_locations (email_lower);
create index if not exists idx_paychex_user_locations_location
  on paychex_user_locations (location_slug);
