/**
 * ABC Financial calls used by the trial-waiver flow: create a prospect, attach
 * the signed waiver PDF, flag the account, set the profile photo, and post the
 * first check-in.
 *
 * Extracted from index.js so the GHL survey webhook and the kiosk site run the
 * exact same sequence. Every function here returns a result object rather than
 * throwing, EXCEPT createProspect — a prospect we cannot create has nothing to
 * attach anything to, so that one failure is fatal and the caller must handle it.
 */

const axios = require('axios');

const ABC_BASE_URL = process.env.ABC_BASE_URL || 'https://api.abcfinancial.com/rest';

/**
 * ABC answers 200 with the failure in the BODY for field-validation errors:
 *
 *   { status: { message: "Invalid value for field text - expected format ...",
 *               count: "0", messageCode: "API-..." } }
 *
 * Treating any 200 as success is how a rejected alert, or a waiver document
 * that never attached, gets reported as fine. Every write here goes through
 * this instead.
 */
function abcOk(data) {
  const status = (data && data.status) || {};
  const message = String(status.message || '').toLowerCase();
  if (message && message !== 'success') return false;
  if (status.count !== undefined && String(status.count) === '0') return false;
  return true;
}

function abcFailure(data) {
  const status = (data && data.status) || {};
  return status.message || 'ABC reported a failure with no message';
}

function getAbcHeaders() {
  return {
    app_id: process.env.ABC_APP_ID,
    app_key: process.env.ABC_APP_KEY,
    'Content-Type': 'application/json',
  };
}

/**
 * Create a prospect. `personal` and `agreement` are passed through as ABC
 * expects them — sanitize the values before calling.
 * Returns the ABC member id (ABC calls prospects members once created).
 */
async function createProspect(clubNumber, { personal, agreement }) {
  const payload = { prospects: [{ prospect: { personal, agreement } }] };
  const response = await axios.post(
    `${ABC_BASE_URL}/${clubNumber}/prospects`,
    payload,
    { headers: getAbcHeaders() }
  );
  // ABC answers 200 with the rejection in the body, so a validation failure
  // arrives looking like success with no id attached. Surface ABC's own message
  // rather than the useless "did not return a prospect id" -- staff need to know
  // WHICH field it refused.
  const prospectId = response.data && response.data.result && response.data.result.memberId;
  if (!prospectId) {
    const reason = abcOk(response.data)
      ? 'ABC accepted the request but returned no prospect id'
      : abcFailure(response.data);
    const err = new Error(`ABC refused the prospect: ${reason}`);
    err.abcResponse = response.data;
    throw err;
  }
  return { prospectId, data: response.data };
}

async function uploadDocument(clubNumber, memberId, { pdfBuffer, documentName }) {
  try {
    const response = await axios.post(
      `${ABC_BASE_URL}/${clubNumber}/members/documents/${memberId}`,
      {
        document: pdfBuffer.toString('base64'),
        documentName,
        documentType: 'pdf',
        imageType: 'member_document',
        memberId,
      },
      { headers: getAbcHeaders() }
    );
    if (!abcOk(response.data)) {
      return { success: false, error: abcFailure(response.data), data: response.data };
    }
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: (error.response && error.response.data) || error.message };
  }
}

/**
 * A purple one-time alert so the front desk sees the new profile on the very
 * first check-in and can greet them by name.
 */
async function addMemberAlert(clubNumber, memberId, options = {}) {
  const {
    text = 'NEW PROFILE',
    color = 'Purple',
    showOneTime = 'true',
    acknowledge = 'false',
    // The rest of the documented POST body. `expirationDate` is the important
    // one: alerts cannot be listed, edited or deleted through the API, so it is
    // the ONLY way a persistent alert ever goes away on its own.
    note,
    sound,
    expirationDate,
    allowDoorAccess,
  } = options;

  const payload = { acknowledge, clubNumber, color, showOneTime, text };
  // Sent only when supplied. ABC accepts unknown and empty fields silently, so
  // an always-present blank would look fine and quietly mean nothing.
  if (note !== undefined) payload.note = note;
  if (sound !== undefined) payload.sound = sound;
  if (expirationDate !== undefined) payload.expirationDate = expirationDate;
  if (allowDoorAccess !== undefined) payload.allowDoorAccess = allowDoorAccess;

  try {
    const response = await axios.post(
      `${ABC_BASE_URL}/${clubNumber}/members/alerts/${memberId}`,
      payload,
      { headers: getAbcHeaders() }
    );
    if (!abcOk(response.data)) {
      return { success: false, error: abcFailure(response.data), data: response.data };
    }
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: (error.response && error.response.data) || error.message };
  }
}

async function uploadMemberPicture(clubNumber, memberId, imageBase64) {
  if (!imageBase64) return { success: false, error: 'No image provided', skipped: true };

  // Accept either a bare base64 string or a data: URI from a browser canvas.
  const image = String(imageBase64).replace(/^data:image\/[a-zA-Z+]+;base64,/, '');

  try {
    const response = await axios.put(
      `${ABC_BASE_URL}/${clubNumber}/members/pictures/${memberId}`,
      { image },
      { headers: getAbcHeaders() }
    );
    if (!abcOk(response.data)) {
      return { success: false, error: abcFailure(response.data), data: response.data };
    }
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: (error.response && error.response.data) || error.message };
  }
}

/**
 * ABC wants `YYYY-MM-DD hh:mm:ss.nnnnnn` in CLUB-LOCAL time, not UTC. Sending
 * UTC lands the check-in on the wrong day for anything after 4pm Pacific.
 */
function abcLocalTimestamp(now = new Date()) {
  const pacific = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${pacific.getFullYear()}-${p(pacific.getMonth() + 1)}-${p(pacific.getDate())} ` +
         `${p(pacific.getHours())}:${p(pacific.getMinutes())}:${p(pacific.getSeconds())}.` +
         `${p(pacific.getMilliseconds(), 3)}000`;
}

/**
 * `stationId` must be the club's own 32-char uppercase hex station id from
 * clubs-config.json; ABC rejects anything else. No station id means no
 * check-in, which is a soft skip rather than a failure.
 */
async function postMemberCheckin(clubNumber, memberId, { stationId, allowed = true } = {}) {
  if (!stationId) {
    return { success: false, skipped: true, error: 'No station ID configured for this club' };
  }

  const payload = {
    checkins: [
      {
        access: {
          allowed: allowed ? 'true' : 'false',
          locationTimestamp: abcLocalTimestamp(),
          stationId,
        },
      },
    ],
    clubNumber,
    isRemoteMemberSearchEnabled: 'false',
    memberId,
  };

  try {
    const response = await axios.post(
      `${ABC_BASE_URL}/${clubNumber}/members/checkins/${memberId}`,
      payload,
      { headers: getAbcHeaders() }
    );
    if (!abcOk(response.data)) {
      return { success: false, error: abcFailure(response.data), data: response.data };
    }
    return { success: true, data: response.data };
  } catch (error) {
    return { success: false, error: (error.response && error.response.data) || error.message };
  }
}

module.exports = {
  ABC_BASE_URL,
  abcOk,
  getAbcHeaders,
  createProspect,
  uploadDocument,
  addMemberAlert,
  uploadMemberPicture,
  postMemberCheckin,
  abcLocalTimestamp,
};
