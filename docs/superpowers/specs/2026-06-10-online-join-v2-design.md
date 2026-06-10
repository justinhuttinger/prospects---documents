# Online Join v2 — Type → Term flow, both-price compare, promos, abandoned-lead capture

**Date:** 2026-06-10
**Repos:** `prospects---documents` (widget + public/admin API + DB), `wcs-staff-portal` (admin UI)
**Status:** Approved design, going straight to implementation (user waived spec-review gate).

## Goal

Restructure the Online Join membership selection from a single flat "Pick Your Plan"
step into a **Location → Membership Type → Term** flow, move amenities to the Type
level, show **both Card and ACH/bank prices** for comparison, support **limited-time
promo types unlocked via URL**, and **capture abandoned checkouts to GHL** tagged
`abandoned check out`.

Not live yet (still in testing), so existing test plans can be reassigned in admin
rather than migrated with a risky backfill.

---

## 1. Data model

### New table: `online_join_membership_types`
The "Single / Family / Youth" grouping level. Amenities + eligibility live here.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `wcs_location_id` | text | |
| `type_key` | text | slug, unique per location (e.g. `single`, `family`, `youth`) |
| `type_label` | text | e.g. `Single Membership` |
| `description` | text null | short marketing copy |
| `features` | jsonb default `[]` | amenities list — **single source of truth** |
| `badge` | text null | e.g. `Most Popular` |
| `age_rule_id` | uuid null fk → online_join_age_rules | eligibility at type level |
| `display_order` | int default 0 | |
| `promo_code` | text null | when set, type is hidden unless URL `?promo=` matches |
| `promo_starts_at` | timestamptz null | promo active-window start (null = no lower bound) |
| `promo_ends_at` | timestamptz null | promo active-window end (null = no upper bound) |
| `active` | bool default true | |

Unique index on `(wcs_location_id, type_key)`.

### Altered table: `online_join_plans`
A plan becomes a **child of a type**, representing one term.

- ADD `membership_type_id` uuid null fk → `online_join_membership_types(id)`
- ADD `term` text — `'1yr'` | `'m2m'` (nullable; null tolerated for legacy rows)
- RETIRE per-plan `features` (column stays for back-compat but is ignored by widget/config; amenities now read from the type). `age_rule_id` on the plan is superseded by the type's; keep column, prefer the type's rule.
- Everything else unchanged: `payment_plan_id`, `today_amount`, `monthly_amount`,
  `enrollment_fee`, `payment_plan_id_ach`, `today_amount_ach`, `monthly_amount_ach`,
  `plan_validation_hash`, `campaign_id`, `sales_person_id`, `active`, `display_order`.

Migration file: `migrations/0NN-online-join-types.sql` (next sequential number in the repo).

---

## 2. Public config payload (`GET /api/online-join/config/:loc?promo=CODE`)

`config-loader.js` returns `types[]` instead of flat `plans[]`:

```jsonc
{
  "location": { ... },              // unchanged
  "types": [
    {
      "id": "...",
      "type_key": "single",
      "type_label": "Single Membership",
      "description": "...",
      "features": ["Unlimited gym access", "..."],   // left-aligned in widget
      "badge": "Most Popular",
      "is_promo": false,             // true when this type came in via promo code
      "age_rule": { ... } | null,
      "terms": [
        {
          "plan_id": "...",
          "term": "1yr",             // or "m2m"
          "enrollment_fee": 0,       // 0 / null → widget renders "No enrollment fee"
          "cc":  { "today": 60.0, "monthly": 60.0 },
          "ach": { "today": 55.0, "monthly": 55.0 } | null,
          "has_ach_variant": true
        }
      ]
    }
  ],
  "copy": { ... }                    // unchanged
}
```

**Promo gating (server-side):** a type is included when
`promo_code IS NULL` **OR** (`promo_code === req.query.promo`
**AND** now ≥ `promo_starts_at` (if set) **AND** now ≤ `promo_ends_at` (if set)).
ABC-side IDs (`payment_plan_id*`, hash, campaign, salesperson) are **never** exposed —
only `plan_id` (our row id) per term. Cache key becomes `${locationId}|${promo||''}`.

`/locations` unchanged. `/eligibility` unchanged (still keyed by `plan_id`).

---

## 3. Widget flow (`join-flow-widget.html`) — 7 → 8 steps

1. **Location** — unchanged.
2. **Membership Type** — one card per type:
   - `type_label` + optional badge (auto **"Limited Time"** badge when `is_promo`)
   - **amenities left-aligned** (`text-align:left` on the `ul`/`li`)
   - **Both-price compare block**: for each term, show Card vs Bank, e.g.
     `1-Year — $60/mo card · $55/mo bank` / `Month-to-Month — $70/mo card · $65/mo bank`.
     When a term has no ACH variant, show only the card price for that term.
   - Selecting a card advances to Term.
3. **Term** — 1-Year vs M2M cards for the chosen type:
   - monthly price shown for **both Card and ACH**
   - enrollment line: `$39 enrollment` or **"No enrollment fee"** when 0/null
   - selecting sets `state.planId` (the term's `plan_id`) and advances.
4. **Tell Us About You** — unchanged contact form.
5. **How You Pay** — CC vs ACH, unchanged. (Required: PayPage must load the correct
   form and `/start` resolves the ACH `paymentPlanId` from this choice.)
6. **PayPage** → 7. **Review & Sign** → 8. **Welcome** — unchanged.

`TOTAL_STEPS` 7 → 8. State adds `state.typeId`. `renderPlanItem` is replaced by
`renderTypeCard` (step 2) + `renderTermCard` (step 3). Progress pills/labels updated.
`?promo=` is parsed from `location.search` and forwarded on the `/config` fetch.

---

## 4. Abandoned-checkout capture → GHL

**On `/start`** (full contact info already in hand, signup row inserted as
`payment_pending`):
- New `upsertAbandonedLead({ signup })` in `ghl-fanout.js` → `POST /contacts/upsert`
  with tags `['abandoned check out', 'online-join']`, `source: 'Online Join'`, plus
  name/email/phone/address/DOB. Store returned `ghl_contact_id` on the signup row.
- Non-blocking: failures log to `online_signup_errors` (errorType `GHL_ABANDONED*`),
  never block the PayPage redirect.

**On `/submit` success** (after the existing `sale`/`member`/`online-join` upsert):
- New `removeContactTag(contactId, 'abandoned check out')` → GHL
  `DELETE /contacts/:id/tags` body `{ tags: ['abandoned check out'] }`.
- Non-blocking + logged.

Operational note (not code): if a GHL "you left something behind" automation is wired
on the `abandoned check out` tag, give it a short wait step so fast-completers (who
briefly carry the tag between `/start` and `/submit`) don't get pinged.

---

## 5. Admin UI (`wcs-staff-portal`)

New **"Membership Types"** management under `Admin → Online Join`:
- CRUD types: label, description, amenities (reuse `FeaturesEditor`), badge, age rule,
  `display_order`, `active`, and **Promo** fields (code + start/end datetime). Promo
  fields collapsed in an optional section; presence of a code shows a "Limited Time" hint.
- Under each type, attach/edit its **1-Year** and **M2M** plans — reuse the existing
  `PlanEditor` (ABC pull + CC/ACH variant + enrollment fee), minus the now-type-level
  fields (features, age rule), plus a `term` selector and the parent `membership_type_id`.
- Existing flat plan list stays accessible; plans display grouped under their type.

New API routes (admin, auth-gated) in the online-join admin router:
`GET/POST/PATCH/DELETE /api/admin/online-join/types` (+ the existing plan routes gain
`membership_type_id` + `term` passthrough). `lib/api.js` `onlineJoin` helper gains
`listTypes/createType/updateType/deactivateType`.

---

## Build order / isolation

Two git worktrees, PRs for review (no auto-merge):

1. **`prospects---documents`** — migration → config-loader → public routes (promo +
   abandoned) → ghl-fanout (abandoned upsert + tag removal) → widget rewrite.
2. **`wcs-staff-portal`** — admin Types API + UI + api.js helpers.

Backend lands first (the widget + admin depend on the new config shape and routes).

## Out of scope
- No data backfill of live members (feature not live).
- No server-side cron for abandoned (capture is synchronous at `/start`).
- Promo = type visibility gating only; not price-override or discount-code math.
