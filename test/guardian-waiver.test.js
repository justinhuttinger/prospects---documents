// test/guardian-waiver.test.js
//
// A minor cannot sign their own waiver, so the adult with them does. The
// document has to say so: without it the PDF reads as though a 15-year-old
// released the club from liability on their own authority, which is the one
// thing the guardian step exists to prevent.
//
// generatePDF posts to PDFShift, so these tests capture the HTML it builds
// rather than rendering a real PDF.
const { test, mock } = require('node:test');
const assert = require('node:assert');
const axios = require('axios');

const { generatePDF } = require('../services/waiver/pdf');

const BASE = {
  first_name: 'Dana',
  last_name: 'Reyes',
  email: 'dana@wcstrength.com',
  location: { name: 'West Coast Strength - Salem' },
  signature_data_url: 'data:image/png;base64,iVBORw0KGgo=',
};

/** Run generatePDF and hand back the HTML it sent to PDFShift. */
async function htmlFor(formData) {
  let captured = '';
  const post = mock.method(axios, 'post', async (url, body) => {
    captured = body.source;
    return { data: Buffer.from('%PDF-1.4 fake') };
  });
  try {
    await generatePDF(formData);
  } finally {
    post.mock.restore();
  }
  return captured;
}

test('an adult waiver is unchanged - no guardian wording anywhere', async () => {
  const html = await htmlFor(BASE);
  assert.ok(html.includes('Digital Signature:'));
  assert.ok(!/parent or guardian/i.test(html));
  assert.ok(!/On Behalf Of/i.test(html));
  assert.ok(!/under 18/i.test(html));
});

test('a guardian-signed waiver names who signed and who it is about', async () => {
  const html = await htmlFor({ ...BASE, guardian_name: 'Pat Reyes', signed_by: 'Pat Reyes' });

  assert.ok(html.includes('Pat Reyes, parent or guardian'), 'names the signer');
  assert.ok(/On Behalf Of[\s\S]*Dana Reyes/.test(html), 'names the member');
  assert.ok(html.includes('under 18'), 'states why somebody else signed');
  // The signature image itself is labelled, so the drawing is not mistaken for
  // the member's own hand.
  assert.ok(html.includes('Digital Signature of Pat Reyes:'));
});

test('a blank or whitespace guardian is treated as no guardian', async () => {
  // A stray empty field must not turn an adult's waiver into a minor's.
  for (const value of ['', '   ', undefined]) {
    const html = await htmlFor({ ...BASE, guardian_name: value });
    assert.ok(!/parent or guardian/i.test(html), JSON.stringify(value));
  }
});
