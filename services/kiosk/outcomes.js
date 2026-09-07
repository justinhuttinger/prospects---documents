/**
 * The tour outcome vocabulary, read from the portal's `tour_outcomes` table.
 *
 * That table is the source of truth for all of it: which outcomes exist, which
 * of them hand out ABC access, how many days each grants, and which one counts
 * as a sale. The portal's own tour queue reads it, its reports group by it, and
 * `docs/TOUR_COMPLETION_API.md` says plainly to fetch it rather than hardcode
 * it -- a new outcome is meant to be a row, not a deploy on either side.
 *
 * THE TRAP, and it is the reason this module exists rather than a constant:
 * `grantsPass` is NOT the same as `defaultPassDays != null`. Only Tour and
 * Custom Pass BOTH have no default length and mean opposite things -- one hands
 * out nothing, the other hands out whatever the staff member chose. Read the
 * flag, never the number.
 *
 * The fallback below is a copy of the live rows, used only when Supabase cannot
 * be reached. A kiosk that cannot read the table should still take a check-in
 * with the vocabulary everyone was using yesterday.
 */

const { getSupabaseAdmin } = require('../../lib/supabase');

const TTL_MS = 10 * 60 * 1000;

// Mirrors the live tour_outcomes rows as of 2026-09-07.
const FALLBACK = [
  { outcome: 'Membership Sale', label: 'Membership Sale', isSale: true, grantsPass: false, defaultPassDays: null, sortOrder: 10 },
  { outcome: 'Started Trial', label: 'Started Trial', isSale: false, grantsPass: true, defaultPassDays: 7, sortOrder: 20 },
  { outcome: 'Started VIP Pass', label: 'Started VIP Pass', isSale: false, grantsPass: true, defaultPassDays: 14, sortOrder: 30 },
  { outcome: 'Only Tour', label: 'Only Tour', isSale: false, grantsPass: false, defaultPassDays: null, sortOrder: 40 },
  { outcome: 'Custom Pass', label: 'Custom Pass', isSale: false, grantsPass: true, defaultPassDays: null, sortOrder: 50 },
];

let cache = null; // { at, rules }

function normalize(row) {
  return {
    outcome: String(row.outcome || ''),
    label: String(row.label || row.outcome || ''),
    isSale: row.is_sale === true,
    grantsPass: row.grants_pass === true,
    defaultPassDays: row.default_pass_days == null ? null : Number(row.default_pass_days),
    sortOrder: Number(row.sort_order || 0),
  };
}

/** Every outcome staff can pick, in the order the table says to show them. */
async function outcomeRules() {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rules;

  let rules = FALLBACK;
  try {
    const { data, error } = await getSupabaseAdmin()
      .from('tour_outcomes')
      .select('outcome, label, is_sale, grants_pass, default_pass_days, sort_order')
      .order('sort_order');
    if (error) throw new Error(error.message);
    const rows = (data || []).map(normalize).filter(r => r.outcome);
    // An empty table is a mistake, not an instruction to offer no outcomes.
    if (rows.length) rules = rows;
  } catch (err) {
    console.warn('[kiosk/outcomes] falling back to the built-in vocabulary:', err.message);
  }

  cache = { at: Date.now(), rules };
  return rules;
}

/**
 * The rules for one club, with any per-club pass length applied.
 *
 * `kiosk.passDays` in clubs-config.json overrides a length, never the
 * grantsPass flag: whether an outcome hands out access is the vocabulary's to
 * decide, and a club quietly disagreeing would make one outcome mean two
 * different things across the estate.
 */
async function rulesForClub(club) {
  const overrides = ((club && club.kiosk) || {}).passDays || {};
  return (await outcomeRules()).map(r =>
    Object.prototype.hasOwnProperty.call(overrides, r.outcome)
      ? { ...r, defaultPassDays: overrides[r.outcome] == null ? null : Number(overrides[r.outcome]) }
      : r
  );
}

function ruleFor(rules, outcome) {
  return rules.find(r => r.outcome === outcome) || null;
}

/** Test seam, and a way to pick up a new outcome without waiting out the TTL. */
function invalidate() {
  cache = null;
}

module.exports = { outcomeRules, rulesForClub, ruleFor, invalidate, FALLBACK, TTL_MS };
