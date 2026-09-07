/**
 * Holding the "kiosk waiver completed" webhook until a staff member says how
 * the tour went.
 *
 * Everywhere else, /submit fires that webhook the moment the waiver is filed
 * and the front desk records the outcome later on the portal's tour queue.
 * Milwaukie has no tour queue: the member hands the tablet back, a staff member
 * answers on the kiosk itself, and only then does GHL hear about it — as one
 * event carrying both the check-in and its result, rather than two that a
 * workflow has to stitch together.
 *
 * The gap between those two moments is a whole tour, so the payload cannot live
 * in memory: a Render restart or a second instance would drop it. It is handed
 * to the tablet instead, as a TICKET — the payload plus an HMAC over it. The
 * kiosk cannot read it usefully and cannot alter it, because /outcome verifies
 * the signature before firing anything. Without that, a public endpoint on a
 * public site would let anyone post whatever they liked into a club's GHL.
 *
 * Tickets expire. A tablet that sat overnight must not be able to file a tour
 * outcome against the morning's follow-up workflows.
 */

const crypto = require('crypto');

const TICKET_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours — a long shift, not a day.

// Reuses the secret this service already holds for the portal webhook. An
// installation with neither variable set still works, but its tickets die with
// the process: better than refusing check-ins, and loud enough to notice.
let ephemeralSecret = null;
function secret() {
  const configured = process.env.KIOSK_OUTCOME_SECRET || process.env.GHL_WEBHOOK_SECRET;
  if (configured) return configured;
  if (!ephemeralSecret) {
    ephemeralSecret = crypto.randomBytes(32).toString('hex');
    console.warn(
      '[kiosk/outcome] no KIOSK_OUTCOME_SECRET or GHL_WEBHOOK_SECRET set; ' +
      'outcome tickets will not survive a restart'
    );
  }
  return ephemeralSecret;
}

function sign(body) {
  return crypto.createHmac('sha256', secret()).update(body).digest('base64url');
}

/** Wrap a webhook payload so the tablet can hand it back later, unaltered. */
function issueTicket(payload) {
  const body = Buffer.from(
    JSON.stringify({ payload, exp: Date.now() + TICKET_TTL_MS })
  ).toString('base64url');
  return `${body}.${sign(body)}`;
}

/**
 * The payload inside a ticket.
 * @returns {{ok: true, payload: object} | {ok: false, error: string}}
 */
function readTicket(ticket) {
  const raw = String(ticket || '');
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return { ok: false, error: 'malformed_ticket' };

  const body = raw.slice(0, dot);
  const given = raw.slice(dot + 1);
  const expected = sign(body);

  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch rather than returning false.
  if (
    given.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected))
  ) {
    return { ok: false, error: 'bad_signature' };
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, error: 'malformed_ticket' };
  }

  if (!decoded || typeof decoded.exp !== 'number' || Date.now() > decoded.exp) {
    return { ok: false, error: 'expired_ticket' };
  }
  return { ok: true, payload: decoded.payload || {} };
}

// What a staff member can pick. Same four the portal's tour queue offers, so
// Milwaukie's tours land in the vocabulary every other club reports in.
const OUTCOMES = [
  'Membership Sale',
  'Started Trial',
  'Started VIP Pass',
  'Only Tour',
];

module.exports = { issueTicket, readTicket, OUTCOMES, TICKET_TTL_MS };
