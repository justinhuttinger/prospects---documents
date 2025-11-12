const express = require('express');
const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');
const axios = require('axios');

const app = express();
app.use(express.json({ limit: '10mb' }));

// Environment variables - set these in Render
const ABC_API_URL = process.env.ABC_API_URL || 'YOUR_ABC_FINANCIAL_API_URL';
const ABC_API_KEY = process.env.ABC_API_KEY || 'YOUR_ABC_API_KEY';

// Club configurations - add your clubs here
const CLUBS = {
  'salem': {
    name: 'West Coast Strength Salem',
    location_id: 'uflpfHNpByAnaBLkQzu3',
    club_id: '30935'  // ABC Financial club ID
  },
  'keizer': {
    name: 'West Coast Strength Keizer',
    location_id: 'KEIZER_LOCATION_ID',
    club_id: 'KEIZER_ABC_CLUB_ID'
  },
  'corvallis': {
    name: 'West Coast Strength Corvallis',
    location_id: 'CORVALLIS_LOCATION_ID',
    club_id: 'CORVALLIS_ABC_CLUB_ID'
  }
  // Add more clubs as needed
};

// Health check endpoint
app.get('/', (req, res) => {
  res.json({ 
    status: 'PDF Service Running',
    version: '1.0.0',
    clubs: Object.keys(CLUBS)
  });
});

// Main webhook endpoint - receives GHL form submissions
app.post('/ghl-trial-form', async (req, res) => {
  try {
    const webhookData = req.body;
    
    console.log('Received webhook from GHL:', JSON.stringify(webhookData, null, 2));
    
    // Parse GHL webhook data
    const formData = parseGHLWebhook(webhookData);
    
    // Determine which club this is for
    const clubKey = identifyClub(formData);
    const club = CLUBS[clubKey];
    
    if (!club) {
      console.error('Unable to identify club from data:', formData);
      return res.status(400).json({ 
        success: false, 
        error: 'Unable to identify club',
        received_location_id: formData.location_id
      });
    }

    console.log(`Processing form for ${club.name}`);

    // Build HTML for PDF
    const html = buildTrialFormHTML(formData, club);
    
    // Generate PDF
    const pdfBuffer = await generatePDF(html);
    
    // Convert to base64
    const pdfBase64 = pdfBuffer.toString('base64');
    
    const fileName = `Trial_Form_${formData.firstName}_${formData.lastName}_${Date.now()}.pdf`;
    const memberId = formData.memberId || formData.email;
    
    console.log(`PDF generated successfully: ${fileName}`);
    
    // Upload to ABC Financial
    const uploadResult = await uploadToABCFinancial({
      pdf: pdfBase64,
      fileName: fileName,
      memberId: memberId,
      clubId: club.club_id,
      documentType: 'Trial Form'
    });
    
    if (!uploadResult.success) {
      console.error('ABC Financial upload failed:', uploadResult.error);
      // Still return success for PDF generation but log the upload failure
      return res.json({
        success: true,
        pdf_generated: true,
        abc_upload: false,
        abc_error: uploadResult.error,
        club: club.name,
        fileName: fileName,
        message: 'PDF generated but ABC upload failed'
      });
    }
    
    console.log(`Successfully uploaded to ABC Financial for member: ${memberId}`);
    
    res.json({
      success: true,
      pdf_generated: true,
      abc_upload: true,
      club: club.name,
      fileName: fileName,
      memberId: memberId,
      abc_document_id: uploadResult.documentId,
      message: 'PDF generated and uploaded successfully'
    });
    
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test endpoint - just generates PDF without uploading
app.post('/test-pdf-generation', async (req, res) => {
  try {
    const formData = req.body;
    
    const clubKey = identifyClub(formData);
    const club = CLUBS[clubKey];
    
    if (!club) {
      return res.status(400).json({ 
        success: false, 
        error: 'Unable to identify club'
      });
    }

    const html = buildTrialFormHTML(formData, club);
    const pdfBuffer = await generatePDF(html);
    const pdfBase64 = pdfBuffer.toString('base64');
    
    res.json({
      success: true,
      club: club.name,
      pdf: pdfBase64,
      fileName: `Trial_Form_${formData.firstName}_${formData.lastName}_${Date.now()}.pdf`,
      note: 'Test mode - not uploaded to ABC Financial'
    });
    
  } catch (error) {
    console.error('Test PDF Generation Error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Parse GHL webhook data into standardized format
function parseGHLWebhook(webhookData) {
  // GHL can send data in different formats depending on trigger type
  // This normalizes it to a consistent structure
  
  // Check if it's form submission data
  if (webhookData.submissionData || webhookData.submission) {
    const data = webhookData.submissionData || webhookData.submission;
    return normalizeFormData(data, webhookData);
  }
  
  // Check if contact data is included
  if (webhookData.contact) {
    return normalizeFormData(webhookData.contact, webhookData);
  }
  
  // Direct field mapping (if webhook sends flat structure)
  return normalizeFormData(webhookData, webhookData);
}

// Normalize form data to consistent field names
function normalizeFormData(data, raw) {
  // Extract location_id from various possible locations
  let locationId = data.location_id || data.locationId || 
                   raw.location_id || raw.locationId ||
                   raw.location || data.location;
  
  // GHL often sends signature as a document URL
  let signatureUrl = data.signatureUrl || data.signature || 
                     data.signature_url || data.signatureImage;
  
  // If signature is in a documents array
  if (data.documents && Array.isArray(data.documents) && data.documents.length > 0) {
    const sigDoc = data.documents.find(doc => 
      doc.type === 'signature' || doc.name?.toLowerCase().includes('signature')
    );
    if (sigDoc && !signatureUrl) {
      signatureUrl = sigDoc.url || sigDoc.downloadUrl;
    }
  }
  
  return {
    location_id: locationId,
    firstName: data.firstName || data.first_name || data.name?.split(' ')[0] || '',
    lastName: data.lastName || data.last_name || data.name?.split(' ').slice(1).join(' ') || '',
    email: data.email || data.email_address || '',
    phone: data.phone || data.phone_number || data.phoneNumber || '',
    streetAddress: data.streetAddress || data.address || data.street || data.address1 || '',
    city: data.city || '',
    state: data.state || '',
    postalCode: data.postalCode || data.zip || data.zipCode || data.postal_code || '',
    dob: data.dob || data.dateOfBirth || data.date_of_birth || data.birthdate || '',
    terms: data.terms || data.termsAndConditions || data.agreement || '',
    signatureUrl: signatureUrl,
    submissionDate: data.submissionDate || data.created_at || data.createdAt || new Date().toISOString(),
    memberId: data.memberId || data.member_id || data.contact_id || data.contactId || data.id,
    // Include raw data for debugging
    _raw: process.env.NODE_ENV === 'development' ? raw : undefined
  };
}

// Upload PDF to ABC Financial
async function uploadToABCFinancial(data) {
  try {
    const { pdf, fileName, memberId, clubId, documentType } = data;
    
    // Build the request payload based on your API spec
    const payload = {
      request: {
        document: pdf,  // base64 string
        documentName: fileName,
        documentType: documentType || 'Trial Form',
        memberId: memberId,
        // Add other fields as needed for your ABC API
      }
    };
    
    console.log(`Uploading to ABC Financial for member ${memberId}`);
    
    const response = await axios.post(ABC_API_URL, payload, {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ABC_API_KEY}`,
        // Add any other required headers
      },
      timeout: 30000  // 30 second timeout
    });
    
    // Check response based on your API structure
    if (response.data && response.data.webAddDocumentResponse) {
      return {
        success: true,
        documentId: response.data.webAddDocumentResponse.documentId,
        status: response.data.webAddDocumentResponse.statusType
      };
    }
    
    // Handle other success scenarios
    if (response.status >= 200 && response.status < 300) {
      return {
        success: true,
        documentId: response.data.documentId || 'unknown',
        response: response.data
      };
    }
    
    return {
      success: false,
      error: 'Unexpected response format',
      response: response.data
    };
    
  } catch (error) {
    console.error('ABC Financial upload error:', error.message);
    return {
      success: false,
      error: error.message,
      details: error.response?.data || null
    };
  }
}

// Identify which club based on form data
function identifyClub(formData) {
  // Method 1: Check location_id if provided
  if (formData.location_id) {
    for (const [key, club] of Object.entries(CLUBS)) {
      if (club.location_id === formData.location_id) {
        return key;
      }
    }
  }
  
  // Method 2: Check email domain or other identifiers
  if (formData.email && formData.email.includes('wcssalem.app')) {
    return 'salem';
  }
  
  // Method 3: Check custom field
  if (formData.club) {
    return formData.club.toLowerCase();
  }
  
  // Default to first club if can't identify
  return Object.keys(CLUBS)[0];
}

// Build HTML template for trial form
function buildTrialFormHTML(data, club) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { 
          font-family: Arial, sans-serif; 
          padding: 40px;
          color: #333;
        }
        .header {
          text-align: center;
          margin-bottom: 30px;
          border-bottom: 3px solid #000;
          padding-bottom: 20px;
        }
        .header h1 { 
          font-size: 24px; 
          margin-bottom: 5px;
        }
        .header h2 { 
          font-size: 18px; 
          color: #666;
          font-weight: normal;
        }
        .section-title {
          background-color: #000;
          color: white;
          padding: 8px 12px;
          font-size: 14px;
          font-weight: bold;
          margin-top: 20px;
          margin-bottom: 10px;
        }
        table { 
          width: 100%; 
          border-collapse: collapse;
          margin-bottom: 20px;
        }
        td { 
          border: 1px solid #ddd; 
          padding: 10px;
          vertical-align: top;
        }
        td:first-child { 
          background-color: #f7f7f7; 
          font-weight: bold; 
          width: 35%;
        }
        .signature-box {
          border: 1px solid #ddd;
          padding: 20px;
          margin-top: 20px;
          text-align: center;
        }
        .signature-box img {
          max-width: 400px;
          height: auto;
          border: 1px solid #ccc;
          padding: 10px;
          background: white;
        }
        .footer {
          margin-top: 30px;
          text-align: center;
          font-size: 10px;
          color: #999;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>${club.name}</h1>
        <h2>Trial Membership Form</h2>
      </div>

      <div class="section-title">PERSONAL INFORMATION</div>
      <table>
        <tr>
          <td>First Name</td>
          <td>${data.firstName || data.first_name || ''}</td>
        </tr>
        <tr>
          <td>Last Name</td>
          <td>${data.lastName || data.last_name || ''}</td>
        </tr>
        <tr>
          <td>Email</td>
          <td>${data.email || ''}</td>
        </tr>
        <tr>
          <td>Phone</td>
          <td>${data.phone || ''}</td>
        </tr>
        <tr>
          <td>Date of Birth</td>
          <td>${data.dob || data.dateOfBirth || ''}</td>
        </tr>
      </table>

      <div class="section-title">ADDRESS</div>
      <table>
        <tr>
          <td>Street Address</td>
          <td>${data.streetAddress || data.address || ''}</td>
        </tr>
        <tr>
          <td>City</td>
          <td>${data.city || ''}</td>
        </tr>
        <tr>
          <td>State</td>
          <td>${data.state || ''}</td>
        </tr>
        <tr>
          <td>Postal Code</td>
          <td>${data.postalCode || data.zip || ''}</td>
        </tr>
      </table>

      <div class="section-title">TERMS & CONDITIONS</div>
      <table>
        <tr>
          <td>Agreement</td>
          <td>${data.terms || data.termsAndConditions || 'I agree to terms & conditions'}</td>
        </tr>
        <tr>
          <td>Submission Date</td>
          <td>${data.submissionDate || new Date().toLocaleString()}</td>
        </tr>
      </table>

      ${data.signatureUrl ? `
        <div class="section-title">SIGNATURE</div>
        <div class="signature-box">
          <img src="${data.signatureUrl}" alt="Member Signature" />
        </div>
      ` : ''}

      <div class="footer">
        Generated on ${new Date().toLocaleString()} | ${club.name}
      </div>
    </body>
    </html>
  `;
}

// Generate PDF from HTML
async function generatePDF(html) {
  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless
  });
  
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0' });
  
  const pdf = await page.pdf({
    format: 'Letter',
    printBackground: true,
    margin: {
      top: '0.5in',
      right: '0.5in',
      bottom: '0.5in',
      left: '0.5in'
    }
  });
  
  await browser.close();
  return pdf;
}

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PDF Service running on port ${PORT}`);
  console.log(`Configured clubs: ${Object.keys(CLUBS).join(', ')}`);
});
