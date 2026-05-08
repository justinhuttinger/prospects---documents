const axios = require('axios');

const BASE_URL = 'https://api.abcfinancial.com/rest';

function headers() {
  return {
    app_id: process.env.ABC_APP_ID,
    app_key: process.env.ABC_APP_KEY,
    'Content-Type': 'application/json',
  };
}

async function getMember(clubNumber, memberId) {
  const url = `${BASE_URL}/${clubNumber}/members/${memberId}`;
  const response = await axios.get(url, { headers: headers() });
  return response.data;
}

// PUT a list of UDF name/value pairs onto a member. Each entry is
// { name, value } and ABC enforces:
//   - name must match an existing UDF name configured in OBC (otherwise the
//     whole call fails with "UDF name {x} was not found as a valid UDF.")
//   - value <= 50 chars
// We trim/truncate values defensively before sending.
async function updateMemberUdfs(clubNumber, memberId, udfs) {
  const url = `${BASE_URL}/${clubNumber}/members/udfs/${memberId}`;
  const safe = (udfs || [])
    .filter(u => u && u.name)
    .map(u => ({
      name: String(u.name),
      value: u.value == null ? '' : String(u.value).slice(0, 50),
    }));
  const response = await axios.put(url, { udfs: safe }, { headers: headers() });
  return response.data;
}

async function uploadDocument(clubNumber, memberId, { pdfBuffer, documentName }) {
  const url = `${BASE_URL}/${clubNumber}/members/documents/${memberId}`;
  const payload = {
    document: pdfBuffer.toString('base64'),
    documentName,
    documentType: 'pdf',
    imageType: 'member_document',
    memberId,
  };
  const response = await axios.post(url, payload, { headers: headers() });
  return response.data;
}

function extractName(memberResponse) {
  // ABC returns { members: [{ personal: { firstName, lastName, ... } }] } per their REST docs.
  // Be defensive: support nested array shape OR a flat object shape.
  const m =
    (memberResponse && memberResponse.members && memberResponse.members[0]) ||
    memberResponse ||
    {};
  const personal = m.personal || m;
  return {
    firstName: personal.firstName || '',
    lastName: personal.lastName || '',
  };
}

module.exports = { getMember, uploadDocument, updateMemberUdfs, extractName, BASE_URL };
