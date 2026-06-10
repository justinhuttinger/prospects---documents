# Online Join — Family / Secondary (household) members

**Date:** 2026-06-10
**Repos:** `prospects---documents` (widget + API + DB), `wcs-staff-portal` (admin UI)
**Status:** Approved design, building.

## Goal
Let family membership types add household (secondary) members on the join flow.
ABC creates them under **one agreement** via the `secondaryMembers[]` array, and the
**dues come from a size-matched ABC payment plan** (ABC has no dynamic dues).

## Key facts (from Justin)
- ABC will **not** auto-compute combined dues. Each household-size tier must be its
  own ABC payment plan (its dues = the combined total for that size).
- The **base** family plan already covers **up to 3 total people** (primary + 2).
  Extra plans are only needed for **4+** total.
- The member **does not pick a plan** — they add people and the matching tier plan +
  price is **auto-selected** from the count.
- Secondary members provide **name, DOB, email, phone**; **address is inherited** from
  the primary.
- The household members are collected on a **dedicated step after "Tell Us About You"**
  (shown only for family types).

## Data model
- `online_join_membership_types`: ADD `allow_secondary_members BOOLEAN DEFAULT false`.
- `online_join_plans`: ADD `max_members INT DEFAULT 1` — total people this plan covers.
  Normal plans = 1. Family base = 3. Extra tiers = 4, 5, … Each tier is its own row
  (same `wcs_location_id` + `membership_type_id` + `term`) with its own ABC
  `payment_plan_id` + pricing + enrollment.
- `online_signups`: ADD `secondary_members JSONB DEFAULT '[]'` —
  `[{first_name,last_name,birthday,email,cell_phone}]` (birthday ISO `YYYY-MM-DD`).
- Migration `112_online_join_secondary_members.sql`.

## Public config (`/config`)
- Each type gains `allow_secondary_members`.
- Each `term` gains a `tiers[]` array (sorted by `max_members`):
  `{plan_id, max_members, enrollment_fee, cc:{today,monthly}, ach:{...}|null, has_ach_variant}`.
  The term's existing base fields (`plan_id`, `cc`, `ach`, `enrollment_fee`,
  `has_ach_variant`) continue to reflect the **lowest** tier (base) so the type/term
  cards render unchanged. Non-family terms have a single-tier `tiers` array.

## Widget flow (`join-flow-widget.html`) — 8 → 9 steps
Numeric steps; **step 5 = Household Members** is shown only for family types and
auto-skipped otherwise.

1 Location · 2 Type · 3 Term · 4 Tell Us About You · **5 Household Members** ·
6 How You Pay · 7 PayPage · 8 Review & Sign · 9 Welcome.

- `TOTAL_STEPS = 9`. Display helpers map non-family steps so they read "x / 8"
  (skip step 5): `displayTotal = isFamily ? 9 : 8`; `displayCurrent = isFamily ?
  currentStep : (currentStep <= 4 ? currentStep : currentStep - 1)`. Progress pills
  use these.
- `isFamilyType()` = `selectedType?.allow_secondary_members && term has >1 tier or base max_members>1`.
  Simpler: `selectedType?.allow_secondary_members === true`.
- **advance from step 4 (contact):** family → goto 5; non-family → goto 6.
  **back from step 6:** family → 5; non-family → 4. (`goto` stays linear; the
  contact-continue and pay-back handlers branch on `isFamilyType()`.)
- **Step 5 body:** "Your membership includes you + up to N at no extra cost." A list of
  added members (each: first/last name, DOB `MM/DD/YYYY`, email, phone — address
  inherited), an **Add member** button capped at `maxSecondaries = (highest tier
  max_members) - 1`, a **Remove** per member, and a live **monthly total** from the
  resolved tier. Continue validates every member.
- **Tier resolution:** `total = 1 + secondaryMembers.length`; pick the smallest tier
  with `max_members >= total`; if none bigger exists, the Add button disables at the
  cap. `state.selectedPlan = planFromTier(term, tier)` so all downstream steps (pay,
  review, /start) use the matched plan_id + price.
- **State:** add `secondaryMembers: []`. Reset on `goto` back to type/term changes.

## ABC submit (`abc-agreement.js`)
`buildAgreementPayload` adds, when `signup.secondary_members?.length`:
```
secondaryMembers: { secondaryMemberInfo: signup.secondary_members.map(m => ({
  secondaryFirstName: m.first_name,
  secondaryLastName:  m.last_name,
  secondaryDateOfBirth: m.birthday,            // ISO YYYY-MM-DD (per ABC example)
  secondaryEmail: m.email,
  secondaryMobilePhone: m.cell_phone,
  secondaryHomePhone: m.cell_phone,
  secondaryMailingAddress: 'true',
  secondaryCity: signup.city,                  // inherited from primary
  secondaryState: signup.state,
  secondaryPostalCode: signup.zip_code,
  secondaryCountry: 'US',
})) }
```
The `paymentPlanId` is the resolved tier plan (already on the signup row), so ABC bills
the combined total. **DOB format for secondaries is a test item** — primary uses
MM/DD/YYYY; the ABC example shows ISO for secondaries. Verify on first real test.

## Public routes (`online-join-public.js`)
- `/start`: accept `secondary_members` in the body; validate each (first/last name,
  ISO birthday, email, 10-digit phone); store on the signup row. `plan_id` is the tier
  plan the widget resolved — existing plan lookup/hash logic unchanged.
- `/submit`: unchanged except `buildAgreementPayload` now reads `signup.secondary_members`.
- New validator `validateSecondaryMembers(arr)` in `validators.js`.

## Admin (`wcs-staff-portal`)
- Membership Types editor: **"Allow household / secondary members"** toggle
  (`allow_secondary_members`).
- Plan editor: **"Covers (total members)"** number (`max_members`, default 1; family
  base = 3, extra tiers 4/5…). Plans list may show it.
- `online-join-admin.js`: add `allow_secondary_members` to `TYPE_FIELDS`, `max_members`
  to `PLAN_FIELDS`.

## Out of scope
- No proration / mid-term member add-remove (that's ABC member management, not join).
- Signed PDF lists primary only for now (secondary names can be added later).

## Build order
1. prospects backend: migration → config-loader tiers → validators → /start →
   abc-agreement → admin fields.
2. prospects widget: step 5 + tier resolution + renumber 8→9.
3. portal admin: type toggle + plan max_members field.
