/**
 * Finding somebody in ABC from the name and contact details they just typed.
 *
 * The waiver kiosk used to create an ABC prospect unconditionally, so a
 * returning member who used the wrong tablet quietly got a second profile.
 * This runs at the contact step — the same step that already fires the lead
 * trigger and raises the tour-queue card — so the answer is ready long before
 * submit.
 *
 * The search itself goes to our synced `abc_members` table, not to ABC — see
 * member-search.js for why ABC cannot answer this question at all.
 *
 * Scoring mirrors the tour kiosk's /api/kiosk/lookup, deliberately: two
 * different definitions of "is this the same person" across two kiosks in the
 * same lobby is how duplicates come back.
 *
 *   exact   — one candidate, matched on BOTH phone and email, name agrees.
 *             Safe to attach to without asking.
 *   partial — anything else with at least one candidate. The member has to
 *             confirm; guessing here attaches a waiver to a stranger.
 *   none    — nobody found. Create as normal.
 */

const { searchMembers } = require('./member-search');

const norm = s => String(s || '').trim().toLowerCase();

/**
 * @returns {Promise<{match:'exact'|'partial'|'none', candidates:Array}>}
 */
async function findExistingMember(club, { firstName, lastName, email, phone }) {
  if (!phone && !email) return { match: 'none', candidates: [] };

  const { byPhone, byEmail } = await searchMembers(club.clubNumber, { phone, email });

  // Which inputs found each person matters: agreeing on phone AND email is what
  // separates a confident match from a shared family phone number.
  const dedup = new Map();
  for (const m of byPhone) {
    const id = m.memberId || m.id;
    if (id) dedup.set(id, { member: m, viaPhone: true, viaEmail: false });
  }
  for (const m of byEmail) {
    const id = m.memberId || m.id;
    if (!id) continue;
    const hit = dedup.get(id);
    if (hit) hit.viaEmail = true;
    else dedup.set(id, { member: m, viaPhone: false, viaEmail: true });
  }

  if (!dedup.size) return { match: 'none', candidates: [] };

  const candidates = Array.from(dedup.values()).map(({ member, viaPhone, viaEmail }) => {
    const personal = member.personal || {};
    const nameMatches =
      !!firstName && !!lastName &&
      norm(personal.firstName) === norm(firstName) &&
      norm(personal.lastName) === norm(lastName);

    return {
      abcMemberId: member.memberId || member.id,
      firstName: personal.firstName || '',
      lastName: personal.lastName || '',
      memberStatus: norm(member.memberStatus || personal.memberStatus || ''),
      matchVia: [viaPhone && 'phone', viaEmail && 'email'].filter(Boolean),
      nameMatches,
    };
  });

  const confident =
    candidates.length === 1 &&
    candidates[0].matchVia.length >= 2 &&
    candidates[0].nameMatches;

  return { match: confident ? 'exact' : 'partial', candidates };
}

module.exports = { findExistingMember };
