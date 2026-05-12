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

module.exports = {
  digitsOnly,
  validateContact,
  validateEmergencyContact,
  validatePaymentMethod,
};
