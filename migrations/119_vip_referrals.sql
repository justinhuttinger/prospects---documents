-- migrations/119_vip_referrals.sql
-- VIP Referrals: persistence for the served widget + admin tracking.

create table if not exists public.vip_referral_submissions (
  id uuid primary key default gen_random_uuid(),
  location_slug text not null,
  abc_club_number text,
  audience text not null default 'staff',           -- 'staff' | 'member'
  referrer_first_name text,
  referrer_last_name text,
  referrer_phone text,
  referrer_email text,
  referrer_ghl_contact_id text,
  referrer_abc_member_id text,
  employee_id text,
  employee_name text,
  vip_count int not null default 0,
  status text not null default 'failed',            -- 'completed' | 'partial' | 'failed'
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.vip_referral_recipients (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid not null references public.vip_referral_submissions(id) on delete cascade,
  first_name text,
  last_name text,
  phone text,
  fanout_status text not null default 'failed',      -- 'sent' | 'failed' | 'skipped'
  http_status int,
  error_detail jsonb,
  webhook_url_used text,
  attempt_count int not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz
);

create table if not exists public.vip_referral_config (
  location_slug text primary key,
  abc_club_number text,
  webhook_url text,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

create index if not exists idx_vip_sub_location_created
  on public.vip_referral_submissions (location_slug, created_at desc);
create index if not exists idx_vip_rec_submission
  on public.vip_referral_recipients (submission_id);
create index if not exists idx_vip_rec_status
  on public.vip_referral_recipients (fanout_status);

alter table public.vip_referral_submissions enable row level security;
alter table public.vip_referral_recipients  enable row level security;
alter table public.vip_referral_config       enable row level security;
