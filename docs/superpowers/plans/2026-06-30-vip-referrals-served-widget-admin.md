# VIP Referrals — Served Widget + Admin Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the VIP referral widget from the backend (auto-updating, iframe-embedded in GHL) and persist every submission + per-VIP fan-out result to Supabase, surfaced in an `Admin → VIP Referrals` page with counts, per-VIP status/errors, retry, and webhook-URL config.

**Architecture:** Mirror the Online Join tool. All backend work (served widget, persistence, admin API) lives in `prospects---documents` behind the existing `requireAdmin` middleware; the `wcs-staff-portal` frontend talks to it directly via `prospectsApi()`. Fan-out logic is extracted into `services/vip-referrals/` and wrapped with persistence. Webhook URLs move from `clubs-config.json` to a `vip_referral_config` table (clubs-config as fallback).

**Tech Stack:** Node/Express, `@supabase/supabase-js` (service role), `node --test` + `node:assert`, axios; React (Vite) + Tailwind for the portal admin page.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-30-vip-referrals-served-widget-admin-design.md`.
- Supabase project `ybopxxydsuwlbwxiuzve`; service-role only — **enable RLS, no policy** on every new table (reference: portal RLS convention).
- Backend tests run with `node --test test/`; no external network in tests — mock axios + Supabase.
- Phone normalization uses the existing `e164()` helper shape (`+1` + 10 digits).
- Admin routes mount behind `requireAdmin` + a router-level CORS shim, exactly like `/api/admin/online-join` (see `index.js`).
- Ships **live, no feature flag**; old pasted widgets must keep working (fan-out reads config table, falls back to `clubs-config.json`).
- Portal: mobile modals must `createPortal` to `body`; copy buttons must show a "Copied!" confirmation animation.
- PRs only — do not merge. Each repo gets its own PR off current `main`/`master`.

---

## File Structure

**prospects---documents**
- Create: `migrations/119_vip_referrals.sql` — 3 tables + RLS + seed config.
- Create: `services/vip-referrals/store.js` — Supabase reads/writes.
- Create: `services/vip-referrals/fanout.js` — `fireRecipient()` with auto-retry.
- Modify: `routes/vip-referrals.js` — POST handler persists + uses store/fanout/config.
- Create: `routes/vip-referrals-admin.js` — admin API.
- Modify: `index.js` — mount served-widget route + admin router.
- Create: `vip-referrals-widget.html` — consolidated served template (audience param + auto-height).
- Create tests: `test/vip-referrals-store.test.js`, `test/vip-referrals-fanout.test.js`, `test/vip-referrals-admin.test.js`.

**wcs-staff-portal**
- Modify: `portal/src/lib/api.js` — add `vipReferrals` object.
- Create: `portal/src/components/admin/VipReferralsAdmin.jsx` — list + counts + filters + detail modal + retry.
- Create: `portal/src/components/admin/VipReferralsConfig.jsx` — webhook URLs + embed snippet.
- Modify: admin nav/routes (wherever `OnlineJoinAdmin` is registered) — add the page.

---

## Task 1: Migration — tables + RLS + config seed

**Files:**
- Create: `migrations/119_vip_referrals.sql` (use 119, the next free number after 118).

**Interfaces:**
- Produces: tables `vip_referral_submissions`, `vip_referral_recipients`, `vip_referral_config` with the columns the store module reads/writes.

- [ ] **Step 1: Write the migration SQL**

```sql
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
```

- [ ] **Step 2: Apply the migration**

Apply via the Supabase MCP `apply_migration` (name `vip_referrals`) against project `ybopxxydsuwlbwxiuzve`, or run the SQL in the SQL editor. Verify with `list_tables` that the 3 tables exist with RLS enabled.

- [ ] **Step 3: Seed `vip_referral_config` from `clubs-config.json`**

Read `clubs-config.json`, and for each enabled club insert a config row. Run this one-off SQL (fill values from the file — one row per club that has a `vipReferralWebhookUrl`, plus rows with null `webhook_url` for clubs that don't yet):

```sql
insert into public.vip_referral_config (location_slug, abc_club_number, webhook_url, enabled)
values
  ('salem','30935','<url-or-null>',true)
  -- ... one row per club from clubs-config.json
on conflict (location_slug) do update
  set webhook_url = excluded.webhook_url,
      abc_club_number = excluded.abc_club_number;
```

- [ ] **Step 4: Commit**

```bash
git add migrations/119_vip_referrals.sql
git commit -m "feat(vip-referrals): migration — submissions/recipients/config tables + RLS"
```

---

## Task 2: `services/vip-referrals/store.js` — persistence

**Files:**
- Create: `services/vip-referrals/store.js`
- Test: `test/vip-referrals-store.test.js`

**Interfaces:**
- Consumes: `getSupabaseAdmin` from `../../lib/supabase`.
- Produces:
  - `getLocationConfig(slug) -> { location_slug, abc_club_number, webhook_url, enabled } | null`
  - `createSubmission(fields) -> submissionId` (inserts submission + recipient rows; `fields.recipients` is `[{first_name,last_name,phone,fanout_status}]`)
  - `recordRecipientResult(recipientId, { fanout_status, http_status, error_detail, webhook_url_used, attempt_count }) -> void`
  - `recomputeSubmissionStatus(submissionId) -> status` (sets submission.status from its recipients)
  - `listSubmissions({ location, from, to, status }) -> { rows, counts }`
  - `getSubmission(id) -> { submission, recipients }`
  - `getRecipient(id) -> recipient | null`
  - `listConfig() -> rows[]`, `updateConfig(slug, patch) -> row`

Because Supabase's chained query builder is awkward to assert against, design `store.js` so the Supabase client is obtained through a single internal `db()` helper that returns `getSupabaseAdmin()`, and the test injects a fake via an exported `__setClientForTest(client)`.

- [ ] **Step 1: Write failing tests**

```js
// test/vip-referrals-store.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../services/vip-referrals/store');

function fakeClient(tables) {
  // tables: { tableName: { rows:[], insertReturn, ... } }
  return {
    from(name) {
      const t = tables[name] || (tables[name] = { rows: [] });
      const q = {
        _filters: [],
        insert(vals) { t.lastInsert = vals; return q; },
        update(vals) { t.lastUpdate = vals; return q; },
        upsert(vals) { t.lastUpsert = vals; return q; },
        select() { return q; },
        eq(col, val) { q._filters.push([col, val]); return q; },
        gte() { return q; },
        lte() { return q; },
        order() { return q; },
        single() { return Promise.resolve({ data: t.singleReturn ?? null, error: null }); },
        then(res) { return Promise.resolve({ data: t.selectReturn ?? t.rows, error: null }).then(res); },
      };
      return q;
    },
  };
}

test('createSubmission inserts a submission and returns its id', async () => {
  const tables = {
    vip_referral_submissions: { singleReturn: { id: 'sub-1' } },
    vip_referral_recipients: {},
  };
  store.__setClientForTest(fakeClient(tables));
  const id = await store.createSubmission({
    location_slug: 'salem', audience: 'staff', vip_count: 2,
    recipients: [{ first_name: 'A', last_name: 'B', phone: '+15035551212', fanout_status: 'failed' }],
  });
  assert.equal(id, 'sub-1');
  assert.equal(tables.vip_referral_submissions.lastInsert.location_slug, 'salem');
  assert.ok(Array.isArray(tables.vip_referral_recipients.lastInsert));
});

test('getLocationConfig returns the row for a slug', async () => {
  store.__setClientForTest(fakeClient({
    vip_referral_config: { singleReturn: { location_slug: 'salem', webhook_url: 'https://x' } },
  }));
  const cfg = await store.getLocationConfig('salem');
  assert.equal(cfg.webhook_url, 'https://x');
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/vip-referrals-store.test.js`
Expected: FAIL — `store.__setClientForTest is not a function` / module not found.

- [ ] **Step 3: Implement `store.js`**

```js
// services/vip-referrals/store.js
const { getSupabaseAdmin } = require('../../lib/supabase');

let _client = null;
function db() { return _client || getSupabaseAdmin(); }
function __setClientForTest(c) { _client = c; }

async function getLocationConfig(slug) {
  const { data } = await db()
    .from('vip_referral_config')
    .select('location_slug, abc_club_number, webhook_url, enabled')
    .eq('location_slug', slug)
    .single();
  return data || null;
}

async function createSubmission(fields) {
  const { recipients = [], ...sub } = fields;
  const { data, error } = await db()
    .from('vip_referral_submissions')
    .insert({
      location_slug: sub.location_slug,
      abc_club_number: sub.abc_club_number || null,
      audience: sub.audience || 'staff',
      referrer_first_name: sub.referrer_first_name || null,
      referrer_last_name: sub.referrer_last_name || null,
      referrer_phone: sub.referrer_phone || null,
      referrer_email: sub.referrer_email || null,
      referrer_ghl_contact_id: sub.referrer_ghl_contact_id || null,
      referrer_abc_member_id: sub.referrer_abc_member_id || null,
      employee_id: sub.employee_id || null,
      employee_name: sub.employee_name || null,
      vip_count: sub.vip_count || recipients.length,
      status: 'failed',
      raw_payload: sub.raw_payload || null,
    })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  const submissionId = data.id;
  if (recipients.length) {
    const rows = recipients.map(r => ({
      submission_id: submissionId,
      first_name: r.first_name || null,
      last_name: r.last_name || null,
      phone: r.phone || null,
      fanout_status: r.fanout_status || 'failed',
    }));
    const { error: rErr } = await db().from('vip_referral_recipients').insert(rows);
    if (rErr) throw new Error(rErr.message);
  }
  return submissionId;
}

async function recordRecipientResult(recipientId, patch) {
  const { error } = await db()
    .from('vip_referral_recipients')
    .update({
      fanout_status: patch.fanout_status,
      http_status: patch.http_status ?? null,
      error_detail: patch.error_detail ?? null,
      webhook_url_used: patch.webhook_url_used ?? null,
      attempt_count: patch.attempt_count ?? 0,
      last_attempt_at: new Date().toISOString(),
      sent_at: patch.fanout_status === 'sent' ? new Date().toISOString() : null,
    })
    .eq('id', recipientId);
  if (error) throw new Error(error.message);
}

async function recomputeSubmissionStatus(submissionId) {
  const { data: recs } = await db()
    .from('vip_referral_recipients')
    .select('fanout_status')
    .eq('submission_id', submissionId);
  const list = recs || [];
  const counted = list.filter(r => r.fanout_status !== 'skipped');
  const sent = counted.filter(r => r.fanout_status === 'sent').length;
  let status = 'failed';
  if (counted.length && sent === counted.length) status = 'completed';
  else if (sent > 0) status = 'partial';
  await db().from('vip_referral_submissions').update({ status }).eq('id', submissionId);
  return status;
}

async function listSubmissions({ location, from, to, status } = {}) {
  let q = db().from('vip_referral_submissions')
    .select('*')
    .order('created_at', { ascending: false });
  if (location) q = q.eq('location_slug', location);
  if (status) q = q.eq('status', status);
  if (from) q = q.gte('created_at', from);
  if (to) q = q.lte('created_at', to);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = data || [];
  const counts = {
    submissions: rows.length,
    vips: rows.reduce((n, r) => n + (r.vip_count || 0), 0),
    completed: rows.filter(r => r.status === 'completed').length,
    partial: rows.filter(r => r.status === 'partial').length,
    failed: rows.filter(r => r.status === 'failed').length,
  };
  return { rows, counts };
}

async function getSubmission(id) {
  const { data: submission } = await db()
    .from('vip_referral_submissions').select('*').eq('id', id).single();
  const { data: recipients } = await db()
    .from('vip_referral_recipients').select('*').eq('submission_id', id);
  return { submission: submission || null, recipients: recipients || [] };
}

async function getRecipient(id) {
  const { data } = await db()
    .from('vip_referral_recipients').select('*').eq('id', id).single();
  return data || null;
}

async function listConfig() {
  const { data } = await db().from('vip_referral_config').select('*').order('location_slug');
  return data || [];
}

async function updateConfig(slug, patch) {
  const { data, error } = await db()
    .from('vip_referral_config')
    .upsert({ location_slug: slug, ...patch, updated_at: new Date().toISOString() })
    .select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

module.exports = {
  getLocationConfig, createSubmission, recordRecipientResult,
  recomputeSubmissionStatus, listSubmissions, getSubmission, getRecipient,
  listConfig, updateConfig, __setClientForTest,
};
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/vip-referrals-store.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/vip-referrals/store.js test/vip-referrals-store.test.js
git commit -m "feat(vip-referrals): Supabase store for submissions/recipients/config"
```

---

## Task 3: `services/vip-referrals/fanout.js` — fire with auto-retry

**Files:**
- Create: `services/vip-referrals/fanout.js`
- Test: `test/vip-referrals-fanout.test.js`

**Interfaces:**
- Consumes: an injectable poster so tests don't hit the network.
- Produces: `fireRecipient(webhookUrl, payload, opts) -> { ok, http_status, error_detail, attempt_count }`
  - Retries on failure up to `opts.maxAttempts` (default 3) with backoff `opts.backoffMs` (default 300) doubling each attempt. `opts.post` defaults to axios; `opts.sleep` defaults to a real timer (tests pass a no-op).

- [ ] **Step 1: Write failing tests**

```js
// test/vip-referrals-fanout.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const { fireRecipient } = require('../services/vip-referrals/fanout');

test('succeeds on first try -> attempt_count 1', async () => {
  let calls = 0;
  const r = await fireRecipient('https://x', { a: 1 }, {
    post: async () => { calls++; return { status: 200 }; },
    sleep: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempt_count, 1);
  assert.equal(calls, 1);
});

test('retries then succeeds -> attempt_count reflects retries', async () => {
  let calls = 0;
  const r = await fireRecipient('https://x', {}, {
    maxAttempts: 3,
    post: async () => { calls++; if (calls < 3) throw Object.assign(new Error('boom'), { response: { status: 502, data: 'bad' } }); return { status: 200 }; },
    sleep: async () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.attempt_count, 3);
});

test('all attempts fail -> ok false, error captured', async () => {
  const r = await fireRecipient('https://x', {}, {
    maxAttempts: 2,
    post: async () => { throw Object.assign(new Error('nope'), { response: { status: 500, data: { e: 1 } } }); },
    sleep: async () => {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.http_status, 500);
  assert.deepEqual(r.error_detail, { e: 1 });
  assert.equal(r.attempt_count, 2);
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `node --test test/vip-referrals-fanout.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `fanout.js`**

```js
// services/vip-referrals/fanout.js
const axios = require('axios');

const defaultSleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fireRecipient(webhookUrl, payload, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 3;
  const backoffMs = opts.backoffMs ?? 300;
  const post = opts.post ?? ((url, body) =>
    axios.post(url, body, { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }));
  const sleep = opts.sleep ?? defaultSleep;

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await post(webhookUrl, payload);
      return { ok: true, http_status: resp.status, error_detail: null, attempt_count: attempt };
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts) await sleep(backoffMs * Math.pow(2, attempt - 1));
    }
  }
  return {
    ok: false,
    http_status: lastErr?.response?.status ?? null,
    error_detail: lastErr?.response?.data ?? lastErr?.message ?? 'unknown',
    attempt_count: maxAttempts,
  };
}

module.exports = { fireRecipient };
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `node --test test/vip-referrals-fanout.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add services/vip-referrals/fanout.js test/vip-referrals-fanout.test.js
git commit -m "feat(vip-referrals): fan-out helper with auto-retry + backoff"
```

---

## Task 4: Refactor `POST /webhooks/vip-referrals` to persist + use config

**Files:**
- Modify: `routes/vip-referrals.js` (the POST handler — keep employees + lookupReferrer as-is).

**Interfaces:**
- Consumes: `store` (Task 2), `fireRecipient` (Task 3).
- Produces: same HTTP response shape `{ ok, fired, total, created, results }` (backward-compatible) plus a persisted submission.

**Behavior:** resolve location → build recipient list (mark incomplete VIP rows `skipped`) → `store.createSubmission` → `lookupReferrer` (existing) → resolve webhook URL from `store.getLocationConfig(slug).webhook_url` **falling back to** `club.vipReferralWebhookUrl` → for each non-skipped recipient call `fireRecipient` and `store.recordRecipientResult` → `store.recomputeSubmissionStatus`.

- [ ] **Step 1: Add imports at the top of `routes/vip-referrals.js`**

```js
const store = require('../services/vip-referrals/store');
const { fireRecipient } = require('../services/vip-referrals/fanout');
```

- [ ] **Step 2: Replace the body of `router.post('/webhooks/vip-referrals', ...)`**

Keep the existing validation (`club`, `member`, `vips.length`, `refFirst/refLast/refPhone`). After the referrer lookup, replace the fan-out loop with:

```js
    // Resolve the webhook URL: config table first, clubs-config.json fallback.
    let inboundUrl = club.vipReferralWebhookUrl;
    let abcClubNumber = club.clubNumber;
    try {
      const cfg = await store.getLocationConfig(slug);
      if (cfg) {
        if (cfg.enabled === false) {
          return res.status(503).json({ ok: false, error: 'location_disabled', location: slug });
        }
        if (cfg.webhook_url) inboundUrl = cfg.webhook_url;
        if (cfg.abc_club_number) abcClubNumber = cfg.abc_club_number;
      }
    } catch (e) { console.warn('[vip-referrals] config lookup failed:', e.message); }

    if (!inboundUrl) {
      return res.status(500).json({ ok: false, error: 'missing_inbound_webhook_url',
        hint: `Set a webhook URL for ${club.clubName} in VIP Referrals admin or clubs-config.json` });
    }

    // Build recipient list — incomplete rows are recorded as skipped.
    const audience = String(body.audience || (employee && employee.id ? 'staff' : 'staff')).toLowerCase();
    const normalized = vips.map(v => {
      const firstName = String(v.firstName || '').trim();
      const lastName  = String(v.lastName  || '').trim();
      const phone     = e164(v.phone);
      const complete  = !!(firstName && lastName && phone);
      return { first_name: firstName, last_name: lastName, phone, complete };
    });

    const submissionId = await store.createSubmission({
      location_slug: slug,
      abc_club_number: abcClubNumber,
      audience,
      referrer_first_name: refFirst,
      referrer_last_name: refLast,
      referrer_phone: refPhone,
      referrer_email: refEmail,
      referrer_ghl_contact_id: refContactId,
      referrer_abc_member_id: refAbcId,
      employee_id: employee.id || null,
      employee_name: employee.name || null,
      vip_count: vips.length,
      raw_payload: body,
      recipients: normalized.map(n => ({
        first_name: n.first_name, last_name: n.last_name, phone: n.phone,
        fanout_status: n.complete ? 'failed' : 'skipped',
      })),
    });

    // Re-read recipients to get their ids in insertion order.
    const { recipients: recRows } = await store.getSubmission(submissionId);
    const results = [];
    for (let i = 0; i < normalized.length; i++) {
      const n = normalized[i];
      const recRow = recRows[i];
      if (!n.complete) { results.push({ ok: false, skipped: 'incomplete', vip: n }); continue; }

      const payload = {
        first_name: n.first_name, last_name: n.last_name, phone: n.phone,
        referred_by_first_name: refFirst, referred_by_last_name: refLast,
        referred_by_full_name: `${refFirst} ${refLast}`,
        referred_by_phone: refPhone, referred_by_email: refEmail,
        referred_by_contact_id: refContactId, referred_by_abc_member_id: refAbcId,
        referral_employee_id: employee.id || '', referral_employee_name: employee.name || '',
        club: club.clubName, location_slug: slug, ghl_location_id: club.ghlLocationId,
        source: 'VIP Survey', submitted_at: body.submittedAt || new Date().toISOString(),
      };

      const r = await fireRecipient(inboundUrl, payload);
      await store.recordRecipientResult(recRow.id, {
        fanout_status: r.ok ? 'sent' : 'failed',
        http_status: r.http_status, error_detail: r.error_detail,
        webhook_url_used: inboundUrl, attempt_count: r.attempt_count,
      });
      results.push({ ok: r.ok, name: `${n.first_name} ${n.last_name}`, status: r.http_status, error: r.ok ? undefined : r.error_detail });
    }

    await store.recomputeSubmissionStatus(submissionId);
    const fired = results.filter(r => r.ok).length;
    return res.json({ ok: true, fired, total: vips.length, created: fired, submissionId, results });
```

- [ ] **Step 3: Manual smoke test (no network)**

Because this handler hits ABC + GHL, verify it loads without syntax errors and the new requires resolve:

Run: `node -e "require('./routes/vip-referrals'); console.log('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Run the full test suite**

Run: `node --test test/`
Expected: existing tests + the two new vip suites PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/vip-referrals.js
git commit -m "feat(vip-referrals): persist submissions + config-driven webhook + auto-retry fan-out"
```

---

## Task 5: Served widget — `GET /widget/vip-referrals` + consolidated template

**Files:**
- Create: `vip-referrals-widget.html` (start by copying `C:\Users\justi\Desktop\GHL HTML\vip-referrals.html` into the repo root).
- Modify: `index.js` — add the route.

**Interfaces:**
- Produces: `GET /widget/vip-referrals?location=<slug>&audience=staff|member` serving the template; the widget posts its height to the parent via `postMessage`.

- [ ] **Step 1: Add the served-widget route in `index.js`**

Next to the existing `app.get('/widget/online-join', ...)` (around line 210):

```js
app.get('/widget/vip-referrals', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.sendFile(__dirname + '/vip-referrals-widget.html');
});
```

- [ ] **Step 2: Create `vip-referrals-widget.html` from the staff file**

Copy `Desktop/GHL HTML/vip-referrals.html` to repo root as `vip-referrals-widget.html`. Then make these edits:

1. **Audience param.** In the widget's bootstrap JS, after `WCS_LOCATION` resolution, add:
   ```js
   var WCS_AUDIENCE = (new URLSearchParams(location.search).get('audience') || window.WCS_AUDIENCE || 'staff').toLowerCase();
   ```
2. **Gate the Team Member section.** Wrap the "Who Helped You?" dropdown block so it renders only when `WCS_AUDIENCE !== 'member'` (mirror what `vip-referrals-member.html` omits). When hidden, ensure the submit payload sends `employee: {}` and `audience: WCS_AUDIENCE`.
3. **Send audience in the POST body.** In the submit handler add `audience: WCS_AUDIENCE` to the JSON body sent to `/webhooks/vip-referrals`.
4. **Auto-height postMessage.** Add near the end of the script:
   ```js
   function wcsPostHeight() {
     var h = document.getElementById('wcs-vip-root') ? document.getElementById('wcs-vip-root').scrollHeight : document.body.scrollHeight;
     parent.postMessage({ type: 'wcs-vip-height', height: h }, '*');
   }
   window.addEventListener('load', wcsPostHeight);
   window.addEventListener('resize', wcsPostHeight);
   new MutationObserver(wcsPostHeight).observe(document.body, { childList: true, subtree: true });
   ```
   (Use the widget's actual root element id; if none, wrap the widget in `<div id="wcs-vip-root">`.)
5. **Point the API base at the served origin.** Confirm the widget's fetch base URL is `https://prospects-documents.onrender.com` (absolute), so it works embedded on any GHL domain — matching how the online-join widget references absolute URLs.

- [ ] **Step 3: Smoke test the route locally**

Run: `node -e "const e=require('express')();require('fs').accessSync('./vip-referrals-widget.html');console.log('template present')"`
Expected: prints `template present`.

Then (optional manual): start the server and open `http://localhost:PORT/widget/vip-referrals?location=salem&audience=member` — verify the member view has no Team Member dropdown and the staff view (`audience=staff`) does.

- [ ] **Step 4: Commit**

```bash
git add vip-referrals-widget.html index.js
git commit -m "feat(vip-referrals): serve consolidated widget with audience param + auto-height"
```

---

## Task 6: Admin API — `routes/vip-referrals-admin.js`

**Files:**
- Create: `routes/vip-referrals-admin.js`
- Modify: `index.js` — mount behind `requireAdmin` + CORS shim.
- Test: `test/vip-referrals-admin.test.js`

**Interfaces:**
- Consumes: `store` (Task 2), `fireRecipient` (Task 3).
- Produces endpoints (all under `/api/admin/vip-referrals`):
  - `GET /submissions?location=&from=&to=&status=` → `{ rows, counts }`
  - `GET /submissions/:id` → `{ submission, recipients }`
  - `POST /recipients/:id/retry` → re-fire one recipient, return updated recipient + submission status
  - `GET /config` → rows; `PATCH /config/:slug` → updated row

For retry, rebuild the per-VIP payload from the stored submission + recipient (the same flat keys the live handler sends). Resolve the webhook URL via `store.getLocationConfig`.

- [ ] **Step 1: Write failing test (router shape, mocked store)**

```js
// test/vip-referrals-admin.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const router = require('../routes/vip-referrals-admin');

function appWith(stubStore) {
  router.__setStoreForTest(stubStore);
  const app = express();
  app.use(express.json());
  app.use('/api/admin/vip-referrals', router);
  return app;
}

async function call(app, method, path, body) {
  const http = require('http');
  const server = app.listen(0);
  const port = server.address().port;
  const data = body ? JSON.stringify(body) : null;
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ port, path, method, headers: { 'Content-Type': 'application/json' } }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => resolve({ status: r.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  server.close();
  return res;
}

test('GET /submissions returns rows + counts', async () => {
  const app = appWith({
    listSubmissions: async () => ({ rows: [{ id: 's1' }], counts: { submissions: 1 } }),
  });
  const res = await call(app, 'GET', '/api/admin/vip-referrals/submissions');
  assert.equal(res.status, 200);
  assert.equal(res.json.counts.submissions, 1);
});

test('GET /submissions/:id returns detail', async () => {
  const app = appWith({
    getSubmission: async () => ({ submission: { id: 's1', status: 'partial' }, recipients: [{ id: 'r1' }] }),
  });
  const res = await call(app, 'GET', '/api/admin/vip-referrals/submissions/s1');
  assert.equal(res.json.submission.status, 'partial');
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `node --test test/vip-referrals-admin.test.js`
Expected: FAIL — module not found / `__setStoreForTest` undefined.

- [ ] **Step 3: Implement `routes/vip-referrals-admin.js`**

```js
// routes/vip-referrals-admin.js
// /api/admin/vip-referrals/* — admin tracking for VIP referrals.
// Mounted behind requireAdmin + CORS shim in index.js (mirrors online-join-admin).
const express = require('express');
let store = require('../services/vip-referrals/store');
const { fireRecipient } = require('../services/vip-referrals/fanout');

const router = express.Router();
function __setStoreForTest(s) { store = s; }

function handleError(res, err, ctx) {
  console.error(`[vip-referrals-admin] ${ctx}:`, err.message);
  res.status(err.status || 500).json({ error: err.message || 'Server error' });
}

router.get('/submissions', async (req, res) => {
  try {
    const { location, from, to, status } = req.query;
    res.json(await store.listSubmissions({ location, from, to, status }));
  } catch (e) { handleError(res, e, 'list'); }
});

router.get('/submissions/:id', async (req, res) => {
  try { res.json(await store.getSubmission(req.params.id)); }
  catch (e) { handleError(res, e, 'detail'); }
});

router.post('/recipients/:id/retry', async (req, res) => {
  try {
    const rec = await store.getRecipient(req.params.id);
    if (!rec) return res.status(404).json({ error: 'recipient_not_found' });
    const { submission } = await store.getSubmission(rec.submission_id);
    const cfg = await store.getLocationConfig(submission.location_slug);
    const url = (cfg && cfg.webhook_url) || rec.webhook_url_used;
    if (!url) return res.status(400).json({ error: 'no_webhook_url' });

    const payload = {
      first_name: rec.first_name, last_name: rec.last_name, phone: rec.phone,
      referred_by_first_name: submission.referrer_first_name,
      referred_by_last_name: submission.referrer_last_name,
      referred_by_full_name: `${submission.referrer_first_name || ''} ${submission.referrer_last_name || ''}`.trim(),
      referred_by_phone: submission.referrer_phone,
      referred_by_email: submission.referrer_email,
      referred_by_contact_id: submission.referrer_ghl_contact_id || '',
      referred_by_abc_member_id: submission.referrer_abc_member_id || '',
      referral_employee_id: submission.employee_id || '',
      referral_employee_name: submission.employee_name || '',
      club: submission.location_slug, location_slug: submission.location_slug,
      source: 'VIP Survey (retry)', submitted_at: new Date().toISOString(),
    };
    const r = await fireRecipient(url, payload);
    await store.recordRecipientResult(rec.id, {
      fanout_status: r.ok ? 'sent' : 'failed', http_status: r.http_status,
      error_detail: r.error_detail, webhook_url_used: url,
      attempt_count: (rec.attempt_count || 0) + r.attempt_count,
    });
    const status = await store.recomputeSubmissionStatus(rec.submission_id);
    res.json({ ok: r.ok, recipient_id: rec.id, submission_status: status });
  } catch (e) { handleError(res, e, 'retry'); }
});

router.get('/config', async (req, res) => {
  try { res.json(await store.listConfig()); }
  catch (e) { handleError(res, e, 'config-list'); }
});

router.patch('/config/:slug', async (req, res) => {
  try {
    const patch = {};
    for (const k of ['abc_club_number', 'webhook_url', 'enabled']) if (k in req.body) patch[k] = req.body[k];
    res.json(await store.updateConfig(req.params.slug, patch));
  } catch (e) { handleError(res, e, 'config-update'); }
});

module.exports = router;
module.exports.__setStoreForTest = __setStoreForTest;
```

- [ ] **Step 4: Mount in `index.js`**

After the online-join admin mount (~line 193), add the same CORS-then-auth pattern:

```js
app.use('/api/admin/vip-referrals', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/admin/vip-referrals', requireAdmin, require('./routes/vip-referrals-admin'));
```

(Match the exact CORS shim the online-join admin block uses just above it — copy its header lines verbatim if they differ.)

- [ ] **Step 5: Run tests, verify they pass**

Run: `node --test test/vip-referrals-admin.test.js`
Expected: PASS (2 tests). Then `node --test test/` — full suite green.

- [ ] **Step 6: Commit**

```bash
git add routes/vip-referrals-admin.js index.js test/vip-referrals-admin.test.js
git commit -m "feat(vip-referrals): admin API — submissions, detail, retry, config"
```

---

## Task 7: Portal API client — `vipReferrals` object

**Files:**
- Modify: `portal/src/lib/api.js` (add after the `onlineJoin` export).

**Interfaces:**
- Consumes: existing `prospectsApi(path, options)`.
- Produces: `vipReferrals` with `listSubmissions`, `getSubmission`, `retryRecipient`, `listConfig`, `updateConfig`.

- [ ] **Step 1: Add the client object**

```js
// ---- VIP Referrals admin (prospects-documents) ---------------------------
export const vipReferrals = {
  listSubmissions: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== '')
    ).toString()
    return prospectsApi('/api/admin/vip-referrals/submissions' + (qs ? `?${qs}` : ''))
  },
  getSubmission: (id) => prospectsApi(`/api/admin/vip-referrals/submissions/${id}`),
  retryRecipient: (id) => prospectsApi(`/api/admin/vip-referrals/recipients/${id}/retry`, { method: 'POST' }),
  listConfig: () => prospectsApi('/api/admin/vip-referrals/config'),
  updateConfig: (slug, body) => prospectsApi(`/api/admin/vip-referrals/config/${encodeURIComponent(slug)}`, { method: 'PATCH', body: JSON.stringify(body) }),
}
```

- [ ] **Step 2: Verify the build compiles**

Run: `cd portal && npx vite build` (or the repo's build script)
Expected: build succeeds (no import errors).

- [ ] **Step 3: Commit**

```bash
git add portal/src/lib/api.js
git commit -m "feat(vip-referrals): portal API client for admin tracking"
```

---

## Task 8: Portal admin page — list, detail, retry, config

**Files:**
- Create: `portal/src/components/admin/VipReferralsAdmin.jsx`
- Create: `portal/src/components/admin/VipReferralsConfig.jsx`
- Modify: admin nav/routes file where `OnlineJoinAdmin` is registered.

**Interfaces:**
- Consumes: `vipReferrals` (Task 7).
- Produces: an `Admin → VIP Referrals` page with a Submissions tab (list + counts + filters + detail modal + retry) and a Config tab (webhook URLs + embed snippet).

- [ ] **Step 1: Build `VipReferralsAdmin.jsx`**

Model on `OnlineJoinSignups.jsx` (status badges, `formatDate`, detail modal pattern). Key pieces:

```jsx
import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { vipReferrals } from '../../lib/api'

const SUB_STATUS = {
  completed: { label: 'All sent', cls: 'bg-green-100 text-green-800' },
  partial:   { label: 'Some failed', cls: 'bg-orange-100 text-orange-800' },
  failed:    { label: 'All failed', cls: 'bg-red-100 text-red-800' },
}
const REC_STATUS = {
  sent:    { label: 'Sent', cls: 'bg-green-100 text-green-800' },
  failed:  { label: 'Failed', cls: 'bg-red-100 text-red-800' },
  skipped: { label: 'Skipped (incomplete)', cls: 'bg-gray-100 text-gray-600' },
}
function fmt(iso) { if (!iso) return '—'; const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleString(undefined, { month:'short', day:'numeric', hour:'numeric', minute:'2-digit' }) }
```

The list view: a filter bar (location select, date from/to, status select), a counts strip (`counts.submissions`, `counts.vips`, `counts.failed`), and a table of submissions (referrer name, location, employee, vip_count, status badge, created_at) where a row opens the detail modal. Detail modal (via `createPortal(…, document.body)`): referrer info + a recipients table with `REC_STATUS` badges; each `failed` recipient gets a **Retry** button:

```jsx
async function onRetry(recipientId) {
  setRetrying(recipientId)
  try { await vipReferrals.retryRecipient(recipientId); await reloadDetail() }
  finally { setRetrying(null) }
}
```

- [ ] **Step 2: Build `VipReferralsConfig.jsx`**

A table of `listConfig()` rows; each location has an editable `webhook_url` (save via `updateConfig`) and an `enabled` toggle. Below each row, a read-only **embed snippet** with a copy button (with the "Copied!" animation):

```jsx
function embedSnippet(slug, audience) {
  return `<iframe id="wcs-vip-${slug}-${audience}" src="https://prospects-documents.onrender.com/widget/vip-referrals?location=${slug}&audience=${audience}" style="width:100%;border:0;min-height:600px" scrolling="no"></iframe>
<script>window.addEventListener('message',function(e){if(e.data&&e.data.type==='wcs-vip-height'){var f=document.getElementById('wcs-vip-${slug}-${audience}');if(f)f.style.height=e.data.height+'px';}});</script>`
}
```

Show both a staff and a member snippet per location.

- [ ] **Step 3: Register the page in admin nav**

Find where `OnlineJoinAdmin` is added to the admin section (search the portal for `OnlineJoinAdmin`), and add a sibling entry "VIP Referrals" → `VipReferralsAdmin`, gated to the same role tier Online Join uses.

- [ ] **Step 4: Verify the build compiles**

Run: `cd portal && npx vite build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add portal/src/components/admin/VipReferralsAdmin.jsx portal/src/components/admin/VipReferralsConfig.jsx <nav-file>
git commit -m "feat(vip-referrals): admin page — submissions, retry, webhook config + embed"
```

---

## Task 9: Open two PRs (no merge)

- [ ] **Step 1:** Push `feat/vip-referrals-served-widget` in `prospects---documents`; open a PR titled "VIP Referrals: served widget + admin tracking" summarizing the served widget, persistence, auto-retry fan-out, and admin API. Note the migration must be applied (already done in Task 1) and that the widget swap in GHL is a per-location rollout step.
- [ ] **Step 2:** Push the matching branch in `wcs-staff-portal`; open a PR titled "VIP Referrals admin page" referencing the prospects PR.
- [ ] **Step 3:** Do **not** merge — Justin merges. Report both PR URLs.

---

## Self-Review

**Spec coverage:**
- Served widget / auto-update → Task 5 ✓
- Iframe auto-height embed → Task 5 (postMessage) + Task 8 (snippet) ✓
- Collapse 14 → 1 (audience param) → Task 5 ✓
- 3 Supabase tables + RLS → Task 1 ✓
- Config replaces clubs-config.json field (with fallback) → Task 1 (seed) + Task 4 (fallback read) ✓
- Persist submissions + per-VIP results → Task 2 + Task 4 ✓
- Auto-retry 2–3× backoff → Task 3 ✓
- Admin list + counts → Task 6 + Task 8 ✓
- Detail + per-VIP status/errors → Task 6 + Task 8 ✓
- Manual retry → Task 6 (endpoint) + Task 8 (button) ✓
- Per-location webhook config → Task 6 + Task 8 ✓
- Ships live, no flag, additive → handled throughout (Task 4 fallback keeps old widgets working) ✓

**Type consistency:** `fireRecipient` returns `{ ok, http_status, error_detail, attempt_count }` — consumed identically in Tasks 4 and 6. `store` method names match between definition (Task 2) and consumers (Tasks 4, 6). `vipReferrals` client method names (Task 7) match the components (Task 8) and the routes (Task 6).

**Placeholder scan:** No TBD/TODO; the one place full code isn't reproduced is the 580-line widget HTML (Task 5), which is an existing asset transformed by explicit enumerated edits rather than rewritten — appropriate, not a placeholder.
