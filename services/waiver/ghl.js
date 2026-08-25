/**
 * GHL side of the kiosk waiver.
 *
 * Two things happen the moment we have a name and a way to reach someone, well
 * before they finish the waiver:
 *   1. upsert the contact, so an abandoned kiosk session is still a captured lead
 *   2. fire the club's inbound webhook, so the club's follow-up workflow starts
 *
 * The upsert returns the contact id, which the final submission carries so the
 * ABC member id lands on the same contact instead of a duplicate.
 *
 * Both calls are best-effort. A GHL outage must not stop somebody signing a
 * waiver at the front desk.
 */

const axios = require('axios');

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';
const GHL_API_VERSION = '2021-07-28';

function e164(s) {
  const d = String(s || '').replace(/\D+/g, '');
  if (!d) return '';
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d[0] === '1') return `+${d}`;
  return `+${d}`;
}

/**
 * Upsert by email + phone so a returning prospect resolves to the contact they
 * already have. `stage` distinguishes the halfway call from the final one.
 */
async function upsertKioskContact(club, lead, { stage = 'lead' } = {}) {
  if (!club.ghlApiKey || !club.ghlLocationId) {
    return { ok: false, skipped: true, error: `Missing GHL config for ${club.clubName}` };
  }

  const phone = e164(lead.phone);
  const body = {
    locationId: club.ghlLocationId,
    firstName: lead.firstName || '',
    lastName: lead.lastName || '',
    name: `${lead.firstName || ''} ${lead.lastName || ''}`.trim() || undefined,
    email: lead.email || undefined,
    phone: phone || undefined,
    address1: lead.address1 || undefined,
    city: lead.city || undefined,
    state: lead.state || undefined,
    postalCode: lead.postalCode || undefined,
    country: 'US',
    dateOfBirth: lead.dateOfBirth || undefined,
    source: 'Kiosk Waiver',
  };

  // Only the halfway call tags. On completion the ABC-to-GHL reconciler owns
  // the member/sale tags, so adding our own here would fight it.
  if (stage === 'lead') body.tags = ['kiosk waiver started'];

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
      const contactId = (resp.data && resp.data.contact && resp.data.contact.id) ||
                        (resp.data && resp.data.id) || null;
      return { ok: true, contactId, status: resp.status };
    }
    return { ok: false, error: `GHL upsert ${resp.status}`, status: resp.status, data: resp.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * POST a flat-key payload to a per-club GHL inbound webhook URL. Flat keys
 * matter: GHL's inbound-webhook custom-data mapping can only bind top-level
 * scalars, so anything nested is invisible to the workflow builder.
 */
async function fireInboundWebhook(url, payload) {
  if (!url) return { ok: false, skipped: true, error: 'No inbound webhook URL configured' };
  try {
    const resp = await axios.post(url, payload, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 15000,
      validateStatus: () => true,
    });
    if (resp.status >= 200 && resp.status < 300) return { ok: true, status: resp.status };
    return { ok: false, status: resp.status, error: `Inbound webhook ${resp.status}`, data: resp.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { upsertKioskContact, fireInboundWebhook, e164 };
