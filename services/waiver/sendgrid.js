/**
 * Confirmation email for a completed kiosk waiver.
 *
 * Prefers a SendGrid dynamic template so marketing can edit the copy without a
 * deploy. With no template id configured it falls back to a plain-text body so
 * the member still gets a receipt rather than silence.
 *
 * Never fatal: the waiver is already on file in ABC by the time this runs.
 */

const axios = require('axios');

const SENDGRID_API_URL = 'https://api.sendgrid.com/v3/mail/send';
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'membership@westcoaststrength.com';
const FROM_NAME = process.env.SENDGRID_FROM_NAME || 'West Coast Strength';

function fallbackText({ firstName, clubName }) {
  return [
    `Hi ${firstName || 'there'},`,
    '',
    `Thanks for checking in at West Coast Strength ${clubName}. Your waiver is signed and your profile is set up, so you are all set to train.`,
    '',
    'If anything on your account looks off, reply to this email or grab a coach at the front desk.',
    '',
    'See you in the gym.',
    'West Coast Strength',
  ].join('\n');
}

/**
 * @returns {Promise<{ok: boolean, skipped?: boolean, status?: number, error?: string}>}
 */
async function sendWaiverConfirmation({ email, firstName, lastName, clubName, clubSlug, abcMemberId }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  if (!apiKey) return { ok: false, skipped: true, error: 'SENDGRID_API_KEY not set' };
  if (!email) return { ok: false, skipped: true, error: 'No email on submission' };

  const templateId = process.env.SENDGRID_TEMPLATE_ID_KIOSK_WAIVER;

  const personalization = {
    to: [{ email, name: `${firstName || ''} ${lastName || ''}`.trim() || undefined }],
  };

  const body = {
    from: { email: FROM_EMAIL, name: FROM_NAME },
    personalizations: [personalization],
  };

  if (templateId) {
    personalization.dynamic_template_data = {
      first_name: firstName || '',
      last_name: lastName || '',
      location_name: clubName || '',
      location_slug: clubSlug || '',
      member_id: String(abcMemberId || ''),
    };
    body.template_id = templateId;
  } else {
    personalization.subject = `You're all set at West Coast Strength ${clubName || ''}`.trim();
    body.content = [{ type: 'text/plain', value: fallbackText({ firstName, clubName }) }];
  }

  try {
    const resp = await axios.post(SENDGRID_API_URL, body, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 10000,
      validateStatus: () => true,
    });
    if (resp.status >= 200 && resp.status < 300) {
      return { ok: true, status: resp.status, usedTemplate: !!templateId };
    }
    return { ok: false, status: resp.status, error: `SendGrid ${resp.status}`, data: resp.data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { sendWaiverConfirmation, fallbackText };
