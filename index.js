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
  // If already 2 letters, return as-is
  if (state.length === 2) return state.toUpperCase();
  // Otherwise look up the code
  return STATE_CODES[state] || state;
}

const app = express();
app.use(express.json());

// Configuration
const ABC_BASE_URL = 'https://api.abcfinancial.com/rest';
const ABC_APP_ID = process.env.ABC_APP_ID;
const ABC_APP_KEY = process.env.ABC_APP_KEY;

const CLUB_NUMBERS = {
  "West Coast Strength - Salem": "30935",
  "West Coast Strength - Keizer": "30934",
  "West Coast Strength - Lancaster": "30936",
  "West Coast Strength - Eugene": "30937",
  "West Coast Strength - Bend": "30938",
  "West Coast Strength - Tigard": "30939",
  // Test club or club 7 - update the name as needed
  "Test Club": "31599",
};

// Helper function to create ABC headers
function getAbcHeaders() {
  return {
    'app_id': ABC_APP_ID,
    'app_key': ABC_APP_KEY,
    'Content-Type': 'application/json'
  };
}

// Helper function to generate PDF
async function generatePDF(formData) {
  return new Promise(async (resolve, reject) => {
    const doc = new PDFDocument({ margin: 50 });
    const chunks = [];

    doc.on('data', chunk => chunks.push(chunk));
    doc.on('end', () => {
      const pdfBuffer = Buffer.concat(chunks);
      resolve(pdfBuffer);
    });
    doc.on('error', reject);

    // PDF Header
    doc.fontSize(20).text('West Coast Strength', { align: 'center' });
    doc.fontSize(16).text('Trial Membership Waiver', { align: 'center' });
    doc.moveDown();

    // Personal Information
    doc.fontSize(14).text('Personal Information', { underline: true });
    doc.fontSize(12);
    doc.text(`Name: ${formData.first_name} ${formData.last_name}`);
    doc.text(`Email: ${formData.email}`);
    doc.text(`Phone: ${formData.phone}`);
    doc.text(`Address: ${formData.address1 || ''}`);
    doc.text(`City: ${formData.city || ''}, ${formData.state || ''} ${formData.postal_code || ''}`);
    doc.text(`Date of Birth: ${formData.date_of_birth ? new Date(formData.date_of_birth).toLocaleDateString() : 'N/A'}`);
    doc.text(`Trial Start Date: ${formData['Trial Start Date'] || 'N/A'}`);
    doc.moveDown();

    // Waiver Text - Full legal text
    doc.fontSize(14).text('Waiver Agreement', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(9);
    
    const waiverText = `I have enrolled for a tour and/or membership offered by West Coast Strength, LLC. West Coast Strength is a strength and conditioning facility with various programs and training options, including but not limited to personal training and strength training.

I recognize that the program may involve strenuous physical activity including, but not limited to, muscle strength and endurance training, cardiovascular conditioning and training, and other various fitness activities. I hereby affirm that I am in good physical condition and do not suffer from any known disability or condition which would prevent or otherwise limit my full participation in this physical program.

In addition, I am fully aware of the risks and hazards connected with the participation in the physical program including, but not limited to, physical injury or even death. I hereby elect to voluntarily participate in this program knowing that the associated physical activity may be hazardous to me and/or my property.

I ASSUME FULL RESPONSIBILITY FOR ANY RISKS OR LOSS, PROPERTY DAMAGE, OR PERSONAL INJURY, INCLUDING DEATH, that may be sustained by me, or loss or damage to property owned by me, as a result of participation in this program.

I hereby release, waive, discharge, and covenant not to sue West Coast Strength, LLC and/or any of its officers, servants, agents, consultants, volunteers, and/or employees from any and all liability, claims, demands, actions, and causes of action whatsoever arising out of or related to any loss, damage, or injury (including, but not limited to, death) that may be sustained by me, or to any property belonging to me, while participating in this program, or while on or upon the premises where the event is being conducted including, but not limited to, any claims arising under negligence.

It is my expressed intent that this waiver and release shall bind any and all members of my family including, but not limited to, my spouse, if I am alive, and my heirs, assigns, and personal representatives, if I am deceased. It is also my expressed intent that this waiver and release shall also be deemed a full release, waiver, discharge, and covenant not to sue insofar as my aforementioned family members, heirs, assigns, and personal representatives are concerned.

I hereby further agree that this waiver and release shall be constructed in accordance with the laws of the State of Oregon.

I HAVE READ THIS AGREEMENT, FULLY UNDERSTAND ITS TERMS, UNDERSTAND THAT I HAVE GIVEN UP SUBSTANTIAL RIGHTS BY SIGNING IT, AND HAVE SIGNED IT FREELY AND VOLUNTARILY WITHOUT ANY INDUCEMENT, ASSURANCE OR GUARANTEE BEING MADE TO ME AND INTEND MY SIGNATURE TO BE A COMPLETE AND UNCONDITIONAL RELEASE OF ALL LIABILITY TO THE GREATEST EXTENT ALLOWED BY LAW.`;
    
    doc.text(waiverText, { align: 'justify', lineGap: 2 });
    doc.moveDown(2);

    // Signature section
    doc.fontSize(12);
    doc.text(`Signed Date: ${new Date().toLocaleDateString()}`);
    doc.text(`Location: ${formData.location?.name || 'N/A'}`);
    doc.moveDown();

    // Download and embed signature image if available
    if (formData['Legal Signature']?.url) {
      try {
        doc.fontSize(12).text('Digital Signature:', { underline: true });
        doc.moveDown(0.5);
        
        // Download the signature image
        const signatureResponse = await axios.get(formData['Legal Signature'].url, {
          responseType: 'arraybuffer'
        });
        
        const signatureBuffer = Buffer.from(signatureResponse.data);
        
        // Add the signature image to PDF
        doc.image(signatureBuffer, {
          fit: [200, 100],
          align: 'left'
        });
        
        // Add extra space after signature image to prevent overlay
        doc.moveDown(2);
        doc.fontSize(10);
        doc.text(`Signature Timestamp: ${formData['Legal Signature'].meta?.timestamp ? new Date(parseInt(formData['Legal Signature'].meta.timestamp) * 1000).toLocaleString() : 'N/A'}`);
      } catch (error) {
        console.error('Error downloading signature image:', error.message);
        doc.fontSize(10).text('(Signature image could not be embedded)');
      }
    }

    doc.end();
  });
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
          firstName: formData.first_name,
          lastName: formData.last_name,
          email: formData.email,
          primaryPhone: formattedPhone,  // <-- Changed
          mobilePhone: formattedPhone,   // <-- Changed
          addressLine1: formData.address1 || '',  // <-- Add fallback
          city: formData.city || '',               // <-- Add fallback
          state: stateCode,
          postalCode: formData.postal_code || '',  // <-- Add fallback
          birthDate: formData.date_of_birth ? new Date(formData.date_of_birth).toISOString().split('T')[0] : '',
          gender: formData.Gender || '',
          employer: "1",
          occupation: "2",
          countryCode: formData.country || "US"
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
      documentName: `Waiver_${formData.first_name}_${formData.last_name}.pdf`,
      documentType: "pdf",
      imageType: "member_document",
      memberId: prospectId
    };

    const documentResponse = await axios.post(documentUrl, documentPayload, {
      headers: getAbcHeaders()
    });

    console.log('Document uploaded:', documentResponse.data);

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
