const axios = require('axios');

async function htmlToPdf(html) {
  const response = await axios.post(
    'https://api.pdfshift.io/v3/convert/pdf',
    { source: html, landscape: false, use_print: false },
    {
      auth: { username: 'api', password: process.env.PDFSHIFT_API_KEY },
      responseType: 'arraybuffer',
    }
  );
  return Buffer.from(response.data);
}

module.exports = { htmlToPdf };
