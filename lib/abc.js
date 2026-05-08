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

module.exports = { getMember, uploadDocument, extractName, BASE_URL };
