/**
 * Field validators used by /start. Server-side trust boundary — the widget
 * also validates client-side for UX but that check is advisory.
 *
 * On failure each function returns a string error message. On success it
 * returns null. Throwing isn't used here because /start collects all errors
 * and returns them at once so the user fixes everything in one round trip.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STATE_RE = /^[A-Za-z]{2}$/;
const ZIP_RE = /^\d{5}(-\d{4})?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function digitsOnly(s) { return String(s || '').replace(/\D+/g, ''); }
function isPresent(s) { return typeof s === 'string' && s.trim().length > 0; }

function validateContact(c = {}) {
  const errors = [];
  if (!isPresent(c.first_name)) errors.push('First name is required.');
  if (!isPresent(c.last_name)) errors.push('Last name is required.');
  if (!EMAIL_RE.test(String(c.email || ''))) errors.push('A valid email is required.');
  if (digitsOnly(c.cell_phone).length < 10) errors.push('A 10-digit phone number is required.');
  if (!DATE_RE.test(String(c.birthday || ''))) errors.push('Birthday must be YYYY-MM-DD.');
  if (!isPresent(c.address_line1)) errors.push('Street address is required.');
  if (!isPresent(c.city)) errors.push('City is required.');
  if (!STATE_RE.test(String(c.state || ''))) errors.push('State must be a 2-letter code.');
  if (!ZIP_RE.test(String(c.zip_code || ''))) errors.push('A valid ZIP code is required.');
  return errors;
}

function validateEmergencyContact(e = {}) {
  const errors = [];
  if (!isPresent(e.first_name)) errors.push('Emergency contact first name is required.');
  if (!isPresent(e.last_name)) errors.push('Emergency contact last name is required.');
  if (digitsOnly(e.phone).length < 10) errors.push('Emergency contact phone must be 10 digits.');
  return errors;
}

function validatePaymentMethod(choice) {
  if (choice !== 'card' && choice !== 'ach') {
    return ['Payment method must be "card" or "ach".'];
  }
  return [];
}

// Household / secondary members (family plans). Each needs name, ISO birthday,
// email, and a 10-digit phone. Address is inherited from the primary, so it's
// not validated here. `arr` may be empty/undefined (non-family signups).
function validateSecondaryMembers(arr) {
  if (arr == null) return [];
  if (!Array.isArray(arr)) return ['Household members must be a list.'];
  const errors = [];
  arr.forEach((m, i) => {
    const n = i + 1;
    const who = `Household member ${n}`;
    if (!isPresent(m?.first_name)) errors.push(`${who}: first name is required.`);
    if (!isPresent(m?.last_name)) errors.push(`${who}: last name is required.`);
    if (!EMAIL_RE.test(String(m?.email || ''))) errors.push(`${who}: a valid email is required.`);
    if (digitsOnly(m?.cell_phone).length < 10) errors.push(`${who}: a 10-digit phone is required.`);
    if (!DATE_RE.test(String(m?.birthday || ''))) errors.push(`${who}: birthday must be YYYY-MM-DD.`);
  });
  return errors;
}

module.exports = {
  digitsOnly,
  validateContact,
  validateEmergencyContact,
  validatePaymentMethod,
  validateSecondaryMembers,
};
