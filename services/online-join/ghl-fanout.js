/**
 * GHL fan-out for /submit. After ABC successfully creates the agreement we
 * upsert a GHL contact and tag it with `sale`, `member`, `online-join`.
 *
 * The `sale` tag is load-bearing — it drives the FB ROAS report. Skipping
 * this fan-out creates a silent reporting gap, so failures here log to
 * online_signup_errors but never block the user-facing success response.
 *
 * Per-location GHL API key is read from clubs-config.json (matches the
 * pattern in vip-referrals / pt-intake / kiosk routes).
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';
const CLUBS_FILE = path.join(__dirname, '..', '..', 'clubs-config.json');

let _clubsCache = null;
function loadClubs() {
  if (_clubsCache) return _clubsCache;
  _clubsCache = JSON.parse(fs.readFileSync(CLUBS_FILE, 'utf8')).clubs || [];
  return _clubsCache;
}

function clubByNumber(clubNumber) {
  const norm = String(clubNumber || '').trim();
  return loadClubs().find(c => c.enabled && String(c.clubNumber) === norm) || null;
}

function e164(s) {
  const d = String(s || '').replace(/\D+/g, '');
  if (!d) return '';
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return `+${d}`;
}

/**
 * Upsert a GHL contact for an online-join sale.
 *
 * Returns { ok: true, contactId } on success.
 * Returns { ok: false, error, status, data } on failure.
 */
async function upsertOnlineJoinContact({ signup, plan, abcMemberId, abcAgreementId }) {
  const club = clubByNumber(signup.abc_club_number);
  if (!club) {
    return { ok: false, error: `No GHL config for club ${signup.abc_club_number}` };
  }
  if (!club.ghlApiKey || !club.ghlLocationId) {
    return { ok: false, error: `Missing ghlApiKey/ghlLocationId for club ${club.clubName}` };
  }

  // Upsert by email + phone. GHL's /contacts/upsert returns the contact and
  // creates it if absent. Tags + customFields are applied in the same call.
  const body = {
    locationId: club.ghlLocationId,
    firstName: signup.first_name || '',
    lastName: signup.last_name || '',
    name: `${signup.first_name || ''} ${signup.last_name || ''}`.trim(),
    email: signup.email || undefined,
    phone: signup.cell_phone ? e164(signup.cell_phone) : undefined,
    address1: signup.address_line1 || undefined,
    city: signup.city || undefined,
    state: signup.state || undefined,
    postalCode: signup.zip_code || undefined,
    country: 'US',
    dateOfBirth: signup.birthday || undefined,
    source: 'Online Join',
    tags: ['sale', 'member', 'online-join'],
    customFields: [
      { key: 'abc_member_id', field_value: String(abcMemberId || '') },
      { key: 'abc_agreement_id', field_value: String(abcAgreementId || '') },
      { key: 'member_sign_date', field_value: new Date().toISOString().slice(0, 10) },
      { key: 'membership_type', field_value: plan.plan_label || plan.plan_key || '' },
    ].filter(cf => cf.field_value),
  };

  try {
    const resp = await axios.post(`${GHL_BASE_URL}/contacts/upsert`, body, {
      headers: {
        Authorization: `Bearer ${club.ghlApiKey}`,
        'Content-Type': 'application/json',
        Version: GHL_API_VERSION,
      },
      timeout: 15000,
      validateStatus: () => true,
    });

    if (resp.status >= 200 && resp.status < 300) {
      const contactId = resp.data?.contact?.id || resp.data?.id || null;
      return { ok: true, contactId, status: resp.status };
    }
    return { ok: false, error: `GHL upsert ${resp.status}`, status: resp.status, data: resp.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { upsertOnlineJoinContact };
