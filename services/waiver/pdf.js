/**
 * Renders the signed liability waiver to PDF via PDFShift.
 *
 * The layout is the club's branded waiver: personal info, health questionnaire,
 * fitness profile, the full release text, and the signature block. Both intake
 * paths feed it the same flat `formData` keys.
 *
 * Signature sources, in order:
 *   1. formData['Legal Signature'].url  — GHL survey hosts the drawing as a file
 *   2. formData.signature_data_url      — the kiosk submits the canvas inline
 *
 * PDFShift auth is basic auth with the literal username "api" and the key as
 * the PASSWORD. Reversing those two returns a 401 that reads like a bad key.
 */

const axios = require('axios');
const path = require('path');

async function generatePDF(formData) {
  try {
    // Load and encode logo
    const fs = require('fs');
    const logoPath = path.join(__dirname, '..', '..', 'logo.png');
    let logoBase64 = '';
    try {
      const logoBuffer = fs.readFileSync(logoPath);
      logoBase64 = `data:image/webp;base64,${logoBuffer.toString('base64')}`;
    } catch (error) {
      console.error('Logo not found, using placeholder');
      logoBase64 = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iODAiIHZpZXdCb3g9IjAgMCA4MCA4MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iODAiIGhlaWdodD0iODAiIGZpbGw9IiNkZGQiLz48L3N2Zz4=';
    }
    
    // Download signature image if the GHL survey path provided a URL.
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
    // Who signed, when that is not the person the waiver is about. Empty for
    // an adult, which leaves the block exactly as it was.
    const guardianName = String(formData.guardian_name || '').trim();
    const memberName = [formData.first_name, formData.last_name]
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .join(' ');

    // Fallback: kiosk submits the drawn signature inline as a data URL,
    // not as a hosted file URL. Use it directly when present.
    if (!signatureBase64 && typeof formData.signature_data_url === 'string'
        && formData.signature_data_url.startsWith('data:image/')) {
      signatureBase64 = formData.signature_data_url;
    }

    // The GHL trial survey asks a health questionnaire and a fitness profile;
    // the kiosk does not. Render each section only when there are answers for
    // it -- a table of "N/A" on a signed waiver reads as a broken document, and
    // dropping the sections outright would regress the survey path.
    const HEALTH_KEYS = [
      'Has a Doctor Ever Said You Have a Heart Condition & Recommended Only Medically Supervised Activity?',
      'Do You Experience Chest Pain During Physical Activity?',
      'Do You Have a Bone or Joint Problem that Physical Activity Could Aggravate?',
      'Has Your Doctor Recommended Medication for your Blood Pressure?',
      'Are you Aware of Any Reason you Should Not Exercise Without Medical Supervision',
    ];
    const FITNESS_KEYS = [
      'What is Your Current Workout Routine?',
      'Do You Follow a Diet / Meal Plan?',
      'What are your Biggest Obstacles?',
      'What Would Help You the Most?',
    ];
    const hasAny = keys => keys.some(k => String(formData[k] || '').trim());
    const hasHealthAnswers = hasAny(HEALTH_KEYS);
    const hasFitnessAnswers = hasAny(FITNESS_KEYS);

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
      ${formData['How Did You Hear About Us'] ? `<div class="info-item"><span class="label">How They Heard About Us:</span> ${formData['How Did You Hear About Us']}</div>` : ''}
    </div>
  </div>
  
${hasHealthAnswers ? `  <div class="section">
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
  </div>` : ''}
  
${hasFitnessAnswers ? `  <div class="section">
    <div class="section-header">FITNESS PROFILE</div>
    <div class="info-grid">
      <div class="info-item"><span class="label">Current Workout Routine:</span> ${formData['What is Your Current Workout Routine?'] || 'N/A'}</div>
      <div class="info-item"><span class="label">Follows Diet/Meal Plan:</span> ${formData['Do You Follow a Diet / Meal Plan?'] || 'N/A'}</div>
      <div class="info-item"><span class="label">Biggest Obstacles:</span> ${formData['What are your Biggest Obstacles?'] || 'N/A'}</div>
      <div class="info-item"><span class="label">What Would Help Most:</span> ${formData['What Would Help You the Most?'] || 'N/A'}</div>
    </div>` : ''}
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
    ${guardianName ? `
      <div class="info-item"><span class="label">Signed By:</span> ${guardianName}, parent or guardian</div>
      <div class="info-item"><span class="label">On Behalf Of:</span> ${memberName} (under 18)</div>
    ` : ''}
    ${signatureBase64 ? `
      <div style="margin-top: 20px;">
        <div class="label">${guardianName ? `Digital Signature of ${guardianName}:` : 'Digital Signature:'}</div>
        <img src="${signatureBase64}" class="signature-img" alt="Signature">
        <div class="signature-info">Timestamp: ${formData['Legal Signature']?.meta?.timestamp ? new Date(parseInt(formData['Legal Signature'].meta.timestamp) * 1000).toLocaleString() : new Date().toLocaleString()}</div>
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

module.exports = { generatePDF };
