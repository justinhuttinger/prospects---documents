const express = require('express');
const axios = require('axios');
const PDFDocument = require('pdfkit');

// Add this near the top, after your constants
const STATE_CODES = {
  'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR', 'California': 'CA',
  'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE', 'Florida': 'FL', 'Georgia': 'GA',
  'Hawaii': 'HI', 'Idaho': 'ID', 'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA',
  'Kansas': 'KS', 'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
  'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS', 'Missouri': 'MO',
  'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ',
  'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH',
  'Oklahoma': 'OK', 'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT', 'Vermont': 'VT',
  'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV', 'Wisconsin': 'WI', 'Wyoming': 'WY'
};

// Add this near the top with the other helper functions
function formatPhoneNumber(phone) {
  if (!phone) return '';
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // Remove leading 1 if present (US country code)
  const phoneDigits = digits.startsWith('1') ? digits.substring(1) : digits;
  
  // Return 10-digit format
  if (phoneDigits.length === 10) {
    return phoneDigits; // ABC accepts plain 10 digits
  }
  
  return phoneDigits;
}

// Helper function to get state code
function getStateCode(state) {
  if (!state) return '';
  
  // Trim spaces and convert to string
  const cleanState = String(state).trim();
  
  if (!cleanState) return '';
  
  // If already 2 letters, return as-is (uppercase and trimmed)
  if (cleanState.length === 2) {
    return cleanState.toUpperCase();
  }
  
  // Otherwise look up the code (after trimming)
  return STATE_CODES[cleanState] || cleanState.substring(0, 2).toUpperCase();
}

// Sanitize name fields for ABC Financial
// Rules: 1-19 alphanumeric chars, apostrophes, hyphens, spaces. Cannot begin with number or space.
function sanitizeName(name, fallback = 'Unknown') {
  if (!name) return fallback;
  
  let sanitized = String(name)
    // Normalize accented characters (é → e, ñ → n, etc.)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Remove everything except allowed: letters, numbers, apostrophes, hyphens, spaces
    .replace(/[^a-zA-Z0-9'\- ]/g, '')
    // Remove leading numbers and spaces
    .replace(/^[\d ]+/, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  // Truncate to 19 characters
  sanitized = sanitized.substring(0, 19);
  
  // If nothing left after sanitization, use fallback
  if (!sanitized || sanitized.length === 0) {
    return fallback;
  }
  
  return sanitized;
}

// Sanitize address fields for ABC Financial
// Rules: 1-44 alphanumeric chars, spaces, forward slashes, pound signs
function sanitizeAddress(address, fallback = 'N/A') {
  if (!address) return fallback;
  
  let sanitized = String(address)
    // Normalize accented characters
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Remove everything except allowed: letters, numbers, spaces, /, #
    .replace(/[^a-zA-Z0-9 /#]/g, '')
    // Collapse multiple spaces
    .replace(/\s+/g, ' ')
    .trim();
  
  // Truncate to 44 characters
  sanitized = sanitized.substring(0, 44);
  
  // If nothing left after sanitization, use fallback
  if (!sanitized || sanitized.length === 0) {
    return fallback;
  }
  
  return sanitized;
}

// Sanitize document name for ABC Financial
// Rules: max 255 chars, only alpha, numeric, spaces and special chars: .,_!%+-@^'
function sanitizeDocumentName(firstName, lastName) {
  // Sanitize each part
  let cleanFirst = String(firstName || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    // Only allow: letters, numbers, spaces, and .,_!%+-@^'
    .replace(/[^a-zA-Z0-9 .,_!%+\-@^']/g, '')
    .trim();
  
  let cleanLast = String(lastName || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9 .,_!%+\-@^']/g, '')
    .trim();
  
  // If both are empty, just return "Waiver.pdf"
  if (!cleanFirst && !cleanLast) {
    return 'Waiver.pdf';
  }
  
  // Build document name with available parts
  let docName;
  if (cleanFirst && cleanLast) {
    docName = `Waiver_${cleanFirst}_${cleanLast}.pdf`;
  } else if (cleanFirst) {
    docName = `Waiver_${cleanFirst}.pdf`;
  } else {
    docName = `Waiver_${cleanLast}.pdf`;
  }
  
  // Truncate to 255 characters if needed (keep .pdf extension)
  if (docName.length > 255) {
    docName = docName.substring(0, 251) + '.pdf';
  }
  
  return docName;
}

const app = express();
app.use(express.json());

// Load clubs configuration
const fs = require('fs');
const clubsConfig = JSON.parse(fs.readFileSync(__dirname + '/clubs-config.json', 'utf8'));

// Build lookup objects from config
const CLUB_NUMBERS = {};
const GHL_API_KEYS = {};

clubsConfig.clubs.forEach(club => {
  if (club.enabled) {
    // Map club name to club number for backwards compatibility
    CLUB_NUMBERS[`West Coast Strength - ${club.clubName}`] = club.clubNumber;
    // Map GHL location ID to API key
    GHL_API_KEYS[club.ghlLocationId] = club.ghlApiKey;
  }
});

console.log('Loaded clubs:', Object.keys(CLUB_NUMBERS));

// Configuration
const ABC_BASE_URL = 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const GHL_BASE_URL = 'https://services.leadconnectorhq.com';

// Helper function to create ABC headers
function getAbcHeaders() {
  return {
    'app_id': ABC_APP_ID,
    'app_key': ABC_APP_KEY,
    'Content-Type': 'application/json'
  };
}

// Helper function to generate PDF using PDF Shift
async function generatePDF(formData) {
  try {
    // Load and encode logo
    const fs = require('fs');
    const logoPath = __dirname + '/logo.png';
    let logoBase64 = '';
    try {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64 = `data:image/webp;base64,${logoBuffer.toString('base64')}`;
    } catch (error) {
      console.error('Logo not found, using placeholder');
      logoBase64 = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAiIGhlaWdodD0iODAiIGZpbGw9IiNkZGQiLz48L3N2Zz4=';
    }
    
    // Download signature image if available
    let signatureBase64 = '';
    if (formData['Legal Signature']?.url) {
      try {
        const signatureResponse = await axios.get(formData['Legal Signature'].url, {
          responseType: 'arraybuffer'
        });
        signatureBase64 = `data:image/png;base64,${Buffer.from(signatureResponse.data).toString('base64')}`;
      } catch (error) {
        console.error('Error downloading signature:', error.message);
      }
    }

    // Create beautiful HTML with your branding
    const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&display=swap" rel="stylesheet">
  <style>
    @page {
      margin: 40px;
    }
    
    body {
      font-family: Arial, sans-serif;
      font-size: 11px;
      line-height: 1.5;
      color: #333;
    }
    
    .header {
      display: flex;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 10px;
    }
    
    .logo {
      width: 80px;
      height: 80px;
      margin-right: 20px;
    }
    
    h1 {
      font-family: 'Bebas Neue', Arial, sans-serif;
      font-size: 28px;
      color: #000;
      margin: 0;
      letter-spacing: 1px;
    }
    
    h2 {
      font-family: 'Bebas Neue', Arial, sans-serif;
      font-size: 20px;
      color: #000;
      margin: 0 0 5px 0;
      letter-spacing: 0.5px;
    }
    
    .red-line {
      height: 3px;
      background-color: #E31837;
      margin: 15px 0 20px 0;
    }
    
    .section {
      margin-bottom: 20px;
    }
    
    .section-header {
      font-family: 'Bebas Neue', Arial, sans-serif;
      font-size: 16px;
      color: #000;
      margin-bottom: 10px;
      letter-spacing: 0.5px;
    }
    
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      margin-bottom: 15px;
    }
    
    .info-item {
      font-size: 10px;
    }
    
    .label {
      font-weight: bold;
      color: #000;
    }
    
    .waiver-text {
      font-size: 9px;
      text-align: justify;
      line-height: 1.4;
      margin-bottom: 20px;
    }
    
    .signature-section {
      margin-top: 30px;
      page-break-inside: avoid;
    }
    
    .signature-img {
      max-width: 200px;
      max-height: 100px;
      margin: 15px 0;
      border-bottom: 2px solid #333;
    }
    
    .signature-info {
      font-size: 10px;
      margin-top: 5px;
    }
    
    .health-table {
      width: 100%;
      font-size: 9px;
      margin-bottom: 15px;
    }
    
    .health-table td {
      padding: 5px;
      border-bottom: 1px solid #ddd;
    }
    
    .health-table td:first-child {
      font-weight: bold;
      width: 70%;
    }
  </style>
</head>
<body>
  <div class="header">
    <img src="${logoBase64}" class="logo" alt="WCS Logo">
    <div>
      <h1>WEST COAST STRENGTH</h1>
      <h2>LIABILITY WAIVER</h2>
    </div>
  </div>
  <div class="red-line"></div>
  
  <div class="section">
    <div class="section-header">PERSONAL INFORMATION</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Name:</span> ${formData.first_name} ${formData.last_name}</div>
      <div class="info-item"><span class="label">Email:</span> ${formData.email}</div>
      <div class="info-item"><span class="label">Phone:</span> ${formData.phone}</div>
      <div class="info-item"><span class="label">Date of Birth:</span> ${formData.date_of_birth ? new Date(formData.date_of_birth).toLocaleDateString() : 'N/A'}</div>
      <div class="info-item"><span class="label">Address:</span> ${formData.address1 || ''}</div>
      <div class="info-item"><span class="label">City, State ZIP:</span> ${formData.city || ''}, ${formData.state || ''} ${formData.postal_code || ''}</div>
      <div class="info-item"><span class="label">Trial Start Date:</span> ${formData['Trial Start Date'] || 'N/A'}</div>
      ${formData['Service Employee'] ? `<div class="info-item"><span class="label">Service Employee:</span> ${formData['Service Employee']}</div>` : ''}
    </div>
  </div>
  
  <div class="section">
    <div class="section-header">HEALTH QUESTIONNAIRE</div>
    <table class="health-table">
      <tr>
        <td>Has a Doctor Ever Said You Have a Heart Condition?</td>
        <td>${formData['Has a Doctor Ever Said You Have a Heart Condition & Recommended Only Medically Supervised Activity?'] || 'N/A'}</td>
      </tr>
      <tr>
        <td>Do You Experience Chest Pain During Physical Activity?</td>
        <td>${formData['Do You Experience Chest Pain During Physical Activity?'] || 'N/A'}</td>
      </tr>
      <tr>
        <td>Do You Have a Bone or Joint Problem?</td>
        <td>${formData['Do You Have a Bone or Joint Problem that Physical Activity Could Aggravate?'] || 'N/A'}</td>
      </tr>
      <tr>
        <td>Has Your Doctor Recommended Medication for Blood Pressure?</td>
        <td>${formData['Has Your Doctor Recommended Medication for your Blood Pressure?'] || 'N/A'}</td>
      </tr>
      <tr>
        <td>Are You Aware of Any Reason You Should Not Exercise?</td>
        <td>${formData['Are you Aware of Any Reason you Should Not Exercise Without Medical Supervision'] || 'N/A'}</td>
      </tr>
    </table>
  </div>
  
  <div class="section">
    <div class="section-header">FITNESS PROFILE</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Current Workout Routine:</span> ${formData['What is Your Current Workout Routine?'] || 'N/A'}</div>
      <div class="info-item"><span class="label">Follows Diet/Meal Plan:</span> ${formData['Do You Follow a Diet / Meal Plan?'] || 'N/A'}</div>
      <div class="info-item"><span class="label">Biggest Obstacles:</span> ${formData['What are your Biggest Obstacles?'] || 'N/A'}</div>
      <div class="info-item"><span class="label">What Would Help Most:</span> ${formData['What Would Help You the Most?'] || 'N/A'}</div>
    </div>
  </div>
  
  <div class="section">
    <div class="section-header">WAIVER AGREEMENT</div>
    <div class="waiver-text">
      I have enrolled for a tour and/or membership offered by West Coast Strength, LLC. West Coast Strength is a strength and conditioning facility with various programs and training options, including but not limited to personal training and strength training.<br><br>
      
      I recognize that the program may involve strenuous physical activity including, but not limited to, muscle strength and endurance training, cardiovascular conditioning and training, and other various fitness activities. I hereby affirm that I am in good physical condition and do not suffer from any known disability or condition which would prevent or otherwise limit my full participation in this physical program.<br><br>
      
      In addition, I am fully aware of the risks and hazards connected with the participation in the physical program including, but not limited to, physical injury or even death. I hereby elect to voluntarily participate in this program knowing that the associated physical activity may be hazardous to me and/or my property.<br><br>
      
      <strong>I ASSUME FULL RESPONSIBILITY FOR ANY RISKS OR LOSS, PROPERTY DAMAGE, OR PERSONAL INJURY, INCLUDING DEATH</strong>, that may be sustained by me, or loss or damage to property owned by me, as a result of participation in this program.<br><br>
      
      I hereby release, waive, discharge, and covenant not to sue West Coast Strength, LLC and/or any of its officers, servants, agents, consultants, volunteers, and/or employees from any and all liability, claims, demands, actions, and causes of action whatsoever arising out of or related to any loss, damage, or injury (including, but not limited to, death) that may be sustained by me, or to any property belonging to me, while participating in this program, or while on or upon the premises where the event is being conducted including, but not limited to, any claims arising under negligence.<br><br>
      
      It is my expressed intent that this waiver and release shall bind any and all members of my family including, but not limited to, my spouse, if I am alive, and my heirs, assigns, and personal representatives, if I am deceased. It is also my expressed intent that this waiver and release shall also be deemed a full release, waiver, discharge, and covenant not to sue insofar as my aforementioned family members, heirs, assigns, and personal representatives are concerned.<br><br>
      
      I hereby further agree that this waiver and release shall be constructed in accordance with the laws of the State of Oregon.<br><br>
      
      <strong>I HAVE READ THIS AGREEMENT, FULLY UNDERSTAND ITS TERMS, UNDERSTAND THAT I HAVE GIVEN UP SUBSTANTIAL RIGHTS BY SIGNING IT, AND HAVE SIGNED IT FREELY AND VOLUNTARILY WITHOUT ANY INDUCEMENT, ASSURANCE OR GUARANTEE BEING MADE TO ME AND INTEND MY SIGNATURE TO BE A COMPLETE AND UNCONDITIONAL RELEASE OF ALL LIABILITY TO THE GREATEST EXTENT ALLOWED BY LAW.</strong>
    </div>
  </div>
  
  <div class="signature-section">
    <div class="section-header">SIGNATURE</div>
    <div class="info-item"><span class="label">Signed Date:</span> ${new Date().toLocaleDateString()}</div>
    <div class="info-item"><span class="label">Location:</span> ${formData.location?.name || 'N/A'}</div>
    ${signatureBase64 ? `
      <div style="margin-top: 20px;">
        <div class="label">Digital Signature:</div>
        <img src="${signatureBase64}" class="signature-img" alt="Signature">
        <div class="signature-info">Timestamp: ${formData['Legal Signature'].meta?.timestamp ? new Date(parseInt(formData['Legal Signature'].meta.timestamp) * 1000).toLocaleString() : 'N/A'}</div>
      </div>
    ` : ''}
  </div>
</body>
</html>
    `;

    // Use PDF Shift API
    const response = await axios.post('https://api.pdfshift.io/v3/convert/pdf', {
      source: html,
      landscape: false,
      use_print: false
    }, {
      auth: {
        username: 'api',
        password: process.env.PDFSHIFT_API_KEY
      },
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
    
  } catch (error) {
    console.error('Error generating PDF:', error.message);
    throw error;
  }
}

// Main webhook handler
app.post('/webhook/ghl-form', async (req, res) => {
  try {
    console.log('=== GHL WEBHOOK RECEIVED ===');
    console.log(JSON.stringify(req.body, null, 2));

    const formData = req.body;

    // 1. Get club number - priority order:
    //    a) Use 'club_number' or 'clubNumber' from webhook data if provided
    //    b) Check inside customData object
    //    c) Fall back to CLUB_NUMBERS mapping based on location name
    let clubNumber = formData.club_number || formData.clubNumber || formData.customData?.club_number;
    const clubName = formData.location?.name;

    if (!clubNumber) {
      // Fall back to mapping by location name
      clubNumber = CLUB_NUMBERS[clubName];
    }

    if (!clubNumber) {
      throw new Error(`Unable to determine club number. Please either: 1) Include 'club_number' in webhook data, or 2) Add "${clubName}" to CLUB_NUMBERS mapping.`);
    }

    console.log(`Processing for club: ${clubName} (${clubNumber})`);

    // 2. Create prospect in ABC Financial
// 2. Create prospect in ABC Financial
const stateCode = getStateCode(formData.state);
const formattedPhone = formatPhoneNumber(formData.phone); // <-- Add this

const prospectPayload = {
  prospects: [
    {
      prospect: {
        personal: {
          firstName: sanitizeName(formData.first_name, 'Unknown'),
          lastName: sanitizeName(formData.last_name, 'Unknown'),
          email: formData.email,
          primaryPhone: formattedPhone,
          mobilePhone: formattedPhone,
          addressLine1: sanitizeAddress(formData.address1, 'N/A'),
          city: sanitizeName(formData.city, 'Unknown'),  // City uses similar rules to names
          state: stateCode,
          postalCode: formData.postal_code || '',
          birthDate: formData.date_of_birth ? new Date(formData.date_of_birth).toISOString().split('T')[0] : '',
          gender: formData.Gender || '',
          employer: "1",
          occupation: "2",
          countryCode: "US"  // Always US regardless of input
        },
        agreement: {
          beginDate: formData['Trial Start Date'] || new Date().toISOString().split('T')[0]
        }
      }
    }
  ]
};

    console.log('Creating prospect in ABC Financial...');
    const prospectResponse = await axios.post(
      `${ABC_BASE_URL}/${clubNumber}/prospects`,
      prospectPayload,
      { headers: getAbcHeaders() }
    );

    console.log('Prospect created:', prospectResponse.data);

// ABC Financial returns memberId directly in result
const prospectId = prospectResponse.data?.result?.memberId;

if (!prospectId) {
  console.error('Full ABC Response:', JSON.stringify(prospectResponse.data, null, 2));
  throw new Error('Failed to get prospect ID from ABC Financial response');
}

console.log(`Prospect ID: ${prospectId}`);

    // 3. Generate PDF
    console.log('Generating PDF...');
    const pdfBuffer = await generatePDF(formData);

    // 4. Upload document to ABC Financial using the new working endpoint
    console.log('Uploading document to ABC Financial...');
    const documentUrl = `${ABC_BASE_URL}/${clubNumber}/members/documents/${prospectId}`;

    const documentPayload = {
      document: pdfBuffer.toString('base64'),
      documentName: sanitizeDocumentName(formData.first_name, formData.last_name),
      documentType: "pdf",
      imageType: "member_document",
      memberId: prospectId
    };

    const documentResponse = await axios.post(documentUrl, documentPayload, {
      headers: getAbcHeaders()
    });

    console.log('Document uploaded:', documentResponse.data);

    // 5. Update GHL contact with ABC Member ID
    console.log('Updating GHL contact with ABC Member ID...');
    try {
      // Get the location-specific API key
      const locationId = formData.location?.id;
      const ghlApiKey = GHL_API_KEYS[locationId];
      
      if (!ghlApiKey) {
        console.warn(`No GHL API key configured for location: ${formData.location?.name} (${locationId})`);
        console.warn('Skipping GHL contact update. Add GHL_API_KEY_[LOCATION] to environment variables.');
      } else {
        const ghlUpdateUrl = `${GHL_BASE_URL}/contacts/${formData.contact_id}`;
        
        const ghlUpdatePayload = {
          customFields: [
            {
              key: 'abc_member_id',
              field_value: prospectId
            }
          ]
        };

        const ghlResponse = await axios.put(ghlUpdateUrl, ghlUpdatePayload, {
          headers: {
            'Authorization': `Bearer ${ghlApiKey}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28'
          }
        });

        console.log('GHL contact updated successfully');
      }
    } catch (ghlError) {
      console.error('Error updating GHL contact (non-fatal):', ghlError.response?.data || ghlError.message);
      // Don't throw - we still succeeded in creating the prospect and uploading the document
    }

    // Success response
    res.json({
      success: true,
      clubNumber,
      prospectId,
      message: 'Prospect created and document uploaded successfully',
      abc_responses: {
        prospect: prospectResponse.data,
        document: documentResponse.data
      }
    });

  } catch (error) {
    console.error('Error processing webhook:', error.response?.data || error.message);
    
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
