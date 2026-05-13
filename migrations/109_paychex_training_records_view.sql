-- A read-only view that flattens each training record together with the
-- best-matched WCS gym location from paychex_user_locations.
--
-- Lookup rule: lower(record.email) → paychex_user_locations.email_lower,
-- newest refreshed_at wins (handles staff who appear in multiple Paychex
-- companies — we pick whichever the resolver saw most recently). NULL when
-- no match exists; the API surfaces those as "Unassigned".

create or replace view paychex_training_records_view as
select
  r.*,
  l.location_slug,
  l.paychex_worker_id,
  l.display_id            as paychex_display_id,
  l.worker_status         as paychex_worker_status
from paychex_training_records r
left join lateral (
  select location_slug, paychex_worker_id, display_id, worker_status
  from paychex_user_locations
  where email_lower = lower(r.email)
  order by refreshed_at desc
  limit 1
) l on true;
