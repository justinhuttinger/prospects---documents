# VIP Referrals — Served Widget + Admin Tracking

**Date:** 2026-06-30
**Status:** Design approved, ready for implementation plan
**Repos:** `prospects---documents` (backend + served widget), `wcs-staff-portal` (admin frontend)

## Problem

The VIP referral system today is **14 static HTML files** hand-pasted into GoHighLevel
Custom HTML blocks (a staff-facing + a member-facing variant for each of 7 locations).
Editing the widget means re-pasting up to 14 GHL blocks. The backend
(`routes/vip-referrals.js`) fans submissions out to a per-club GHL inbound webhook but
**persists nothing** and there is **no visibility** — no way to see how many referrals
came in or whether any webhook fan-outs failed.

Justin wants this to work like the Online Join tool:

1. **Auto-updating widget** — serve the widget once from the backend so editing it
   server-side propagates to every gym with no re-paste.
2. **Admin tracking** — an `Admin → VIP Referrals` page (mirroring `Admin → Online Join`)
   showing how many referrals were submitted, per-VIP fan-out status, and any issues,
   with the ability to retry a failed fan-out.

## Goals

- One served widget template, embedded in GHL via an auto-height iframe.
- Every submission + every per-VIP fan-out result persisted to Supabase.
- Admin page: submission list with counts/filters, a detail view with per-VIP status and
  errors, manual retry of failed fan-outs, and per-location webhook-URL config.
- Automatic retry (2–3 attempts, short backoff) of a failed fan-out before it is marked
  failed for manual retry.
- Ships **additively** — the old pasted widgets keep working until each GHL block is
  swapped to the iframe. No feature flag.

## Non-Goals

- No change to the GHL inbound-webhook → "Create Contact" workflows themselves (the
  per-VIP payload shape stays the same; only persistence wraps around it).
- No rebuild of the widget's visual design — it keeps its current look; it just gets
  served and gains audience-param awareness.
- No migration of the *other* clubs-config.json fields — only `vipReferralWebhookUrl`
  moves to a config table (with clubs-config as fallback).

## Architecture (mirrors Online Join)

Same two-repo split the Online Join admin already uses: the **portal frontend talks
directly to the prospects-documents backend** via `prospectsApi()`
(`VITE_PROSPECTS_API_URL` → `https://prospects-documents.onrender.com`). Admin API routes
live in prospects-documents behind the existing `requireAdmin` middleware, exactly like
`/api/admin/online-join/*`.

```
GHL Custom HTML block (per location/audience)
  └─ <iframe src=".../widget/vip-referrals?location=salem&audience=member"> + resize listener
        │  GET  /widget/vip-referrals      (prospects-documents, serves 1 template)
        │  GET  /api/vip-referrals/employees?location=   (existing, ABC employee dropdown)
        └─ POST /webhooks/vip-referrals     (existing route, refactored)
              ├─ insert submission + recipient rows (Supabase)
              ├─ fan out one POST per VIP to the per-club GHL webhook (auto-retry 2–3x)
              └─ update recipient + submission status

wcs-staff-portal frontend  (Admin → VIP Referrals)
  └─ prospectsApi() → /api/admin/vip-referrals/*   (prospects-documents, requireAdmin)
        GET  /submissions?location=&from=&to=&status=
        GET  /submissions/:id
        POST /recipients/:id/retry        (or /submissions/:id/retry)
        GET/PATCH /config                 (per-location webhook URLs)
```

## Data model (new Supabase tables, shared project `ybopxxydsuwlbwxiuzve`)

RLS enabled, no policy (service-role only), per the portal convention
([[reference_supabase_rls]]).

### `vip_referral_submissions` — one row per form submit
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `location_slug` | text | e.g. `salem` |
| `abc_club_number` | text | resolved from clubs-config at write time |
| `audience` | text | `staff` \| `member` |
| `referrer_first_name` / `referrer_last_name` | text | |
| `referrer_phone` | text | E.164 |
| `referrer_email` | text null | |
| `referrer_ghl_contact_id` | text null | from `lookupReferrer` |
| `referrer_abc_member_id` | text null | from `lookupReferrer` |
| `employee_id` / `employee_name` | text null | null for member audience |
| `vip_count` | int | number of VIP rows submitted |
| `status` | text | `completed` (all sent) \| `partial` (some failed) \| `failed` (all failed) |
| `raw_payload` | jsonb | full submitted body for debugging |
| `created_at` | timestamptz default now() | |

### `vip_referral_recipients` — one row per VIP
| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `submission_id` | uuid fk → submissions | on delete cascade |
| `first_name` / `last_name` | text | |
| `phone` | text | E.164 |
| `fanout_status` | text | `sent` \| `failed` \| `skipped` (incomplete VIP row) |
| `http_status` | int null | last webhook HTTP status |
| `error_detail` | jsonb null | last error body/message |
| `webhook_url_used` | text null | the GHL inbound URL fired |
| `attempt_count` | int default 0 | includes auto-retries |
| `last_attempt_at` | timestamptz null | |
| `sent_at` | timestamptz null | set when fanout_status → sent |

### `vip_referral_config` — one row per location
| column | type | notes |
|---|---|---|
| `location_slug` | text pk | |
| `abc_club_number` | text | |
| `webhook_url` | text null | the per-club GHL inbound webhook |
| `enabled` | boolean default true | |
| `updated_at` | timestamptz default now() | |

Seeded from current `clubs-config.json` `vipReferralWebhookUrl` values via the migration.
The fan-out reads `vip_referral_config.webhook_url` first and falls back to
`clubs-config.json` if the row is missing/blank (safe during migration).

## Backend changes — `prospects---documents`

### Served widget
- `GET /widget/vip-referrals` → `res.sendFile('vip-referrals-widget.html')` (new single
  template), mirroring the existing `GET /widget/online-join` route.
- Build `vip-referrals-widget.html` by consolidating `vip-referrals.html` (staff) and
  `vip-referrals-member.html` (member) into one file. Audience is resolved from
  `?audience=member|staff` (default `staff`); the "Who Helped You?" Team Member dropdown
  renders only for `staff`. Location is resolved from `?location=` (existing
  `WCS_LOCATION` precedence kept for backward compatibility).
- **Auto-height:** the widget posts its scrollHeight to the parent via `postMessage` on
  load/resize/VIP-row add/remove; the GHL embed snippet includes a listener that sets the
  iframe height. Removes clipping/scroll as rows expand 1→5.

### Persistence + fan-out refactor
- Extract the fan-out loop from `routes/vip-referrals.js` into
  `services/vip-referrals/fanout.js` (`fireRecipient(webhookUrl, payload)` with auto-retry
  2–3 attempts, short exponential backoff, honoring any error).
- New `services/vip-referrals/store.js` — Supabase writes/reads (insert submission +
  recipients, update recipient result, recompute submission status, list/detail queries,
  config read/write). Supabase client mirrors the online-join service.
- `POST /webhooks/vip-referrals` refactored: resolve location → insert submission +
  recipient rows (status `failed`/`skipped` initial) → look up referrer (existing) → fan
  out each VIP via `fireRecipient` reading `webhook_url` from config → update each
  recipient → set submission status (`completed`/`partial`/`failed`). Response shape kept
  backward-compatible (`{ ok, fired, total, results }`).

### Admin API — `routes/vip-referrals-admin.js` (mounted `/api/admin/vip-referrals`, `requireAdmin` + CORS shim, same as online-join)
- `GET /submissions?location=&from=&to=&status=` → list + aggregate counts (total
  submissions, total VIPs, sent, failed).
- `GET /submissions/:id` → submission + its recipients (with errors).
- `POST /recipients/:id/retry` → re-fire one failed recipient via `fireRecipient`, update
  the row + parent submission status. (Optionally `POST /submissions/:id/retry` to retry
  all failed recipients in a submission.)
- `GET /config` / `PATCH /config/:slug` → read/update `vip_referral_config` webhook URLs +
  enabled.

## Frontend changes — `wcs-staff-portal`

- `portal/src/lib/api.js` — add a `vipReferrals` object mirroring `onlineJoin`, using
  `prospectsApi()`:
  `listSubmissions(params)`, `getSubmission(id)`, `retryRecipient(id)`, `listConfig()`,
  `updateConfig(slug, body)`.
- `portal/src/components/admin/VipReferralsAdmin.jsx` — submission list + counts + filters
  (location, date range, status), modeled on `OnlineJoinSignups.jsx`. Mobile modals must
  `createPortal` to body ([[reference_mobile_modal_portal]]).
- `VipReferralsDetail` modal — per-VIP rows with status badges + error detail + a Retry
  button on failed rows (with the "Copied!"/loading affordances the codebase uses).
- `VipReferralsConfig` tab — edit each gym's webhook URL + a copy-paste **embed snippet**
  (iframe + resize listener) per location/audience, with the copy-confirmation animation
  ([[feedback_copy_animation]]).
- Register the page in the admin nav/routes alongside Online Join, gated to the same
  admin/manager tier Online Join uses.

## Rollout

1. Apply the migration (3 tables + RLS) and seed `vip_referral_config` from
   `clubs-config.json`.
2. Deploy prospects-documents (served widget + persistence + admin API) and the portal
   (admin page). Both ship live; old pasted widgets unaffected.
3. Per location: copy the embed snippet from the admin Config tab into that gym's GHL
   Custom HTML block (staff + member), replacing the pasted widget. Verify a test
   submission appears in admin and the GHL contact is created.
4. Once all 7 gyms are swapped, the 14 Desktop files are reference-only.

## Open questions / risks

- **iframe auto-height in GHL:** GHL Custom HTML blocks sometimes wrap content in their
  own container; confirm the `postMessage` resize listener works inside a GHL funnel/site
  page (Online Join's PR #388 embed snippet is the reference). Fallback: a generous fixed
  min-height.
- **Cross-origin referrer lookup unchanged:** `lookupReferrer` stays as-is; persistence
  does not depend on it succeeding.
- **Service-to-service auth for retry:** retry runs entirely inside prospects-documents
  (the portal only calls the admin API behind `requireAdmin`), so no new cross-service
  auth is needed — the fan-out logic and webhook URLs already live there.
