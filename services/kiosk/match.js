/**
 * Finding somebody in ABC from the name and contact details they just typed.
 *
 * The waiver kiosk used to create an ABC prospect unconditionally, so a
 * returning member who used the wrong tablet quietly got a second profile.
 * This runs at the contact step — the same step that already fires the lead
 * trigger and raises the tour-queue card — so the answer is ready long before
 * submit.
 *
 * Two sources, because no single one holds everybody:
 *
 *   members    our synced `abc_members` table, not ABC — see member-search.js
 *              for why ABC cannot answer this question at all. Complete, but it
 *              holds join_status = 'Member' ONLY.
 *   prospects  ABC live, last 30 days. Nothing syncs prospects, so without this
 *              anybody whose only record is a past trial was invisible and got a
 *              brand new profile every visit. See prospect-search.js for the
 *              window and why it exists.
 *
 * A member match wins over a prospect match for the same person: the member
 * record is the one with their history on it, and attaching a waiver to a stale
 * prospect when they have since joined is the wrong record to touch.
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
const { searchProspects } = require('./prospect-search');

const norm = s => String(s || '').trim().toLowerCase();

/**
 * @returns {Promise<{match:'exact'|'partial'|'none', candidates:Array}>}
 */
async function findExistingMember(club, { firstName, lastName, email, phone }) {
  if (!phone && !email) return { match: 'none', candidates: [] };

  // Run both together: the prospect call goes to ABC and is the slow one, and
  // this sits on the step that also raises the queue card, where the member is
  // waiting on the screen.
  const [members, prospects] = await Promise.all([
    searchMembers(club.clubNumber, { phone, email }),
    searchProspects(club.clubNumber, { phone, email }),
  ]);

  // Members first so that a person who is BOTH -- an old prospect who later
  // joined -- dedupes onto the member record rather than the prospect one.
  const byPhone = [...members.byPhone, ...prospects.byPhone];
  const byEmail = [...members.byEmail, ...prospects.byEmail];

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
      // Lets the kiosk say "you started a trial with us" rather than implying a
      // membership, and lets submit attach instead of creating a second one.
      isProspect: !!member.isProspect,
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
