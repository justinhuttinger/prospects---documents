/**
 * Local sandbox for the kiosk flow.
 *
 * Boots the real express app with every OUTBOUND call stubbed, so the kiosk
 * site can be driven end to end against a real HTTP server without creating an
 * ABC prospect, a GHL contact, or sending an email.
 *
 *   node scripts/kiosk-sandbox.js            # port 3100
 *   node scripts/kiosk-sandbox.js 4000
 *
 * Then point the kiosk at it:  VITE_API_BASE=http://localhost:3100 npm run dev
 *
 * Every stubbed call is logged, so you can watch the sequence the kiosk causes.
 */

const axios = require('axios');

let seq = 0;

function log(method, url, body) {
  seq += 1;
  const short = String(url).replace('https://api.abcfinancial.com/rest', 'ABC')
    .replace('https://services.leadconnectorhq.com', 'GHL')
    .replace('https://api.sendgrid.com/v3', 'SENDGRID')
    .replace('https://api.pdfshift.io/v3', 'PDFSHIFT');
  const size = body ? ` (${JSON.stringify(body).length} bytes)` : '';
  console.log(`  ${String(seq).padStart(2)}. ${method.toUpperCase().padEnd(4)} ${short}${size}`);
}

for (const method of ['get', 'post', 'put']) {
  axios[method] = async (url, ...rest) => {
    const body = method === 'get' ? undefined : rest[0];
    log(method, url, body);

    if (String(url).includes('/prospects')) {
      return { status: 200, data: { result: { memberId: 'SANDBOX-1001' } } };
    }
    if (String(url).includes('pdfshift.io')) {
      return { status: 200, data: Buffer.from('%PDF-1.4 sandbox') };
    }
    if (String(url).includes('/contacts/upsert')) {
      return { status: 200, data: { contact: { id: 'SANDBOX-GHL-1' } } };
    }
    return { status: 200, data: { sandbox: true } };
  };
}

process.env.ABC_APP_ID = process.env.ABC_APP_ID || 'sandbox';
process.env.ABC_APP_KEY = process.env.ABC_APP_KEY || 'sandbox';
process.env.PDFSHIFT_API_KEY = process.env.PDFSHIFT_API_KEY || 'sandbox';

const app = require('../index.js');
const port = Number(process.argv[2]) || 3100;

app.listen(port, () => {
  console.log(`\nKiosk sandbox on http://localhost:${port}`);
  console.log('All outbound ABC / GHL / SendGrid / PDFShift calls are stubbed.\n');
});
