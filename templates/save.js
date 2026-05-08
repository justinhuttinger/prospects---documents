const fs = require('fs');
const path = require('path');

let logoCache;
function logoBase64() {
  if (logoCache !== undefined) return logoCache;
  try {
    const buf = fs.readFileSync(path.join(__dirname, '..', 'logo.png'));
    logoCache = `data:image/png;base64,${buf.toString('base64')}`;
  } catch {
    logoCache = '';
  }
  return logoCache;
}

const STYLES = `
@page { margin: 40px; }
body { font-family: Arial, sans-serif; font-size: 11px; line-height: 1.5; color: #333; }
.header { display: flex; align-items: center; margin-bottom: 10px; padding-bottom: 10px; }
.logo { width: 80px; height: 80px; margin-right: 20px; }
h1 { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 28px; color: #000; margin: 0; letter-spacing: 1px; }
h2 { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 20px; color: #000; margin: 0 0 5px 0; letter-spacing: 0.5px; }
.red-line { height: 3px; background-color: #E31837; margin: 15px 0 20px 0; }
.section { margin-bottom: 20px; }
.section-header { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 16px; color: #000; margin-bottom: 10px; letter-spacing: 0.5px; }
.info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 15px; }
.info-item { font-size: 10px; }
.label { font-weight: bold; color: #000; }
.fin-table { width: 100%; font-size: 10px; border-collapse: collapse; }
.fin-table td { padding: 6px 8px; border-bottom: 1px solid #ddd; }
.fin-table td:first-child { font-weight: bold; width: 60%; }
.offer-card { border: 1px solid #ddd; border-radius: 4px; padding: 10px 12px; margin-bottom: 8px; font-size: 10px; }
.offer-card .offer-type { font-family: 'Bebas Neue', Arial, sans-serif; font-size: 13px; color: #E31837; letter-spacing: 0.5px; margin-bottom: 4px; }
.footer { margin-top: 40px; font-size: 9px; color: #666; }
`;

function escape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function freezeBody(r) {
  return `
    <div class="info-grid">
      <div class="info-item"><span class="label">Status:</span> ${escape(r.status)}</div>
      <div class="info-item"><span class="label">Freeze Type:</span> ${escape(r.freezeType)}</div>
      <div class="info-item"><span class="label">Reason Code:</span> ${escape(r.freezeCode)}</div>
      <div class="info-item"><span class="label">Reason:</span> ${escape(r.freezeReason)}</div>
      <div class="info-item"><span class="label">Period (days):</span> ${escape(r.freezePeriod)}</div>
      <div class="info-item"><span class="label">Dates:</span> ${escape(r.startDate)} – ${escape(r.endDate)}</div>
      <div class="info-item"><span class="label">Fee:</span> $${escape(r.fee)}</div>
    </div>`;
}

function offerCard(o) {
  const type = String(o.offer || '').toUpperCase();
  const d = o.dict || {};
  let body = '';

  if (type === 'MONETARY') {
    const dd = d.discountDues || {};
    body = `
      <div><span class="label">Discount Value:</span> ${escape(dd.value)}</div>
      <div><span class="label">Type:</span> ${escape(dd.type)}</div>
      <div><span class="label">Duration (cycles):</span> ${escape(dd.durationPeriod)}</div>`;
  } else if (type === 'POS') {
    const items = Array.isArray(o.array) ? o.array : [];
    const list = items.map(i => `<li>${escape(i.sku)}</li>`).join('') || '<li>(none)</li>';
    body = `<div><span class="label">SKUs:</span><ul style="margin: 4px 0 0 18px;">${list}</ul></div>`;
  } else if (type === 'FREEZE') {
    body = `
      <div><span class="label">Reason:</span> ${escape(d.reasonCode)} ${d.reasonName ? '— ' + escape(d.reasonName) : ''}</div>
      <div><span class="label">Freeze Type:</span> ${escape(d.freezeType)}</div>
      <div><span class="label">Period (days):</span> ${escape(d.freezePeriod)}</div>
      <div><span class="label">Dates:</span> ${escape(d.startDate)} – ${escape(d.endDate)}</div>
      <div><span class="label">Fee:</span> $${escape(d.value)}</div>`;
  } else if (type === 'LOCATION') {
    body = `<div><span class="label">Transfer:</span> ${escape(d.fromClubCode)} → ${escape(d.toClubCode)}</div>`;
  } else if (type === 'MEMBERSHIP') {
    body = `<div><span class="label">Plan:</span> ${escape(d.planName)}</div>`;
  } else if (type === 'CREDIT') {
    body = `
      <div><span class="label">Amount:</span> $${escape(d.amount)}</div>
      <div><span class="label">Comments:</span> ${escape(d.comments)}</div>`;
  } else if (type === 'MANUAL') {
    const keys = Object.keys(d || {});
    body = keys.length
      ? keys.map(k => `<div><span class="label">${escape(k)}:</span> ${escape(d[k])}</div>`).join('')
      : '<div>Custom offer applied</div>';
  } else {
    body = `<div>Unknown offer type — raw: <code>${escape(JSON.stringify(o))}</code></div>`;
  }

  return `
    <div class="offer-card">
      <div class="offer-type">${escape(type)} &nbsp;<span style="color:#666;font-family:inherit;">${escape(o.status || '')}</span></div>
      ${body}
    </div>`;
}

function offerBody(r) {
  const offers = Array.isArray(r.offers) ? r.offers : [];
  const cards = offers.map(offerCard).join('') || '<div>(no offer items)</div>';
  return `
    <div class="info-item" style="margin-bottom:8px;"><span class="label">Status:</span> ${escape(r.status)}</div>
    ${cards}`;
}

function render({ requestId, requestType, occurredAt, data, member }) {
  const m = data.member || {};
  const r = data.result || {};
  const f = data.financials || {};
  const fullName = `${member.firstName} ${member.lastName}`.trim() || '(name not on file)';

  const eventBlock = requestType === 'FREEZE' ? freezeBody(r) : offerBody(r);
  const sectionLabel = requestType === 'FREEZE' ? 'FREEZE DETAILS' : 'SAVE OFFER';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
  <style>${STYLES}</style>
</head>
<body>
  <div class="header">
    <img src="${logoBase64()}" class="logo" alt="WCS Logo">
    <div>
      <h1>WEST COAST STRENGTH</h1>
      <h2>RETENTION SAVE</h2>
    </div>
  </div>
  <div class="red-line"></div>

  <div class="section">
    <div class="section-header">MEMBER</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Name:</span> ${escape(fullName)}</div>
      <div class="info-item"><span class="label">Email:</span> ${escape(m.email)}</div>
      <div class="info-item"><span class="label">Member ID:</span> ${escape(m.memberId)}</div>
      <div class="info-item"><span class="label">Agreement ID:</span> ${escape(m.agreementId)}</div>
      <div class="info-item"><span class="label">Barcode:</span> ${escape(m.barcode)}</div>
      <div class="info-item"><span class="label">Club Code:</span> ${escape(data.clubCode)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-header">${sectionLabel}</div>
    ${eventBlock}
  </div>

  <div class="section">
    <div class="section-header">FINANCIALS</div>
    <table class="fin-table">
      <tr><td>Past Due Balance</td><td>$${escape(f.pastDueBalance)}</td></tr>
      <tr><td>Past Due Collected</td><td>$${escape(f.pastDueCollected)}</td></tr>
      <tr><td>Next Due Amount</td><td>$${escape(f.nextDueAmount)}</td></tr>
      <tr><td>Next Due Collected</td><td>$${escape(f.nextDueCollected)}</td></tr>
      <tr><td>Buyout Collected</td><td>$${escape(f.buyoutCollected)}</td></tr>
    </table>
  </div>

  <div class="footer">
    Generated by Click2Save → WCS &nbsp;·&nbsp; Request ID: ${escape(requestId)} &nbsp;·&nbsp; Occurred At: ${escape(occurredAt)}
  </div>
</body>
</html>`;
}

module.exports = { render };
