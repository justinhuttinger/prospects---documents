# WCS PDF Generation Service

Automated PDF generation and upload service for West Coast Strength trial form submissions. Receives webhooks directly from GoHighLevel and uploads documents to ABC Financial - no third-party automation tools required.

## 🎯 What It Does

1. **Receives** form submission webhooks from GHL
2. **Identifies** which club (Salem, Keizer, etc.)
3. **Generates** professional PDF with signature
4. **Uploads** to ABC Financial member account
5. **Reports** success or failure

All automatic. No manual intervention needed.

## 🚀 Quick Start

### Prerequisites
- GitHub account
- Render account (free tier works)
- GHL with webhook access
- ABC Financial API credentials

### Setup (10 minutes)

1. **Clone/Download** this repository
2. **Configure clubs** in `index.js`
3. **Push to GitHub**
4. **Deploy to Render** (connects to GitHub)
5. **Add webhooks** in GHL workflows
6. **Test** with a form submission

Detailed instructions: [SETUP_GUIDE.md](SETUP_GUIDE.md)

## 📋 Features

✅ **Multi-club support** - Handles all WCS locations  
✅ **Automatic club identification** - Uses location_id from GHL  
✅ **Professional PDF generation** - Clean, branded layout  
✅ **Signature embedding** - Downloads and includes signatures  
✅ **Direct ABC upload** - No manual steps  
✅ **Flexible field mapping** - Handles various GHL field names  
✅ **Error handling** - Detailed logging for troubleshooting  
✅ **Zero maintenance** - Auto-deploys from GitHub  

## 🔧 Configuration

### Club Setup

Edit `index.js` to configure your clubs:

```javascript
const CLUBS = {
  'salem': {
    name: 'West Coast Strength Salem',
    location_id: 'uflpfHNpByAnaBLkQzu3',  // From GHL
    club_id: 'SALEM_ABC_ID'                // From ABC Financial
  },
  // Add more clubs...
};
```

### Environment Variables

Set in Render dashboard:

```
ABC_API_URL = https://your-abc-endpoint.com/upload
ABC_API_KEY = your_api_key
NODE_ENV = production
```

## 📡 API Endpoints

### Main Webhook Endpoint
```
POST /ghl-trial-form
```

Receives GHL webhooks, generates PDF, uploads to ABC Financial.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "phone": "+15035551234",
  "location_id": "uflpfHNpByAnaBLkQzu3",
  "signatureUrl": "https://services.leadconnectorhq.com/...",
  ...
}
```

**Success Response:**
```json
{
  "success": true,
  "pdf_generated": true,
  "abc_upload": true,
  "club": "West Coast Strength Salem",
  "fileName": "Trial_Form_John_Doe_1699876543210.pdf",
  "memberId": "john@example.com",
  "message": "PDF generated and uploaded successfully"
}
```

### Test Endpoint (PDF only, no upload)
```
POST /test-pdf-generation
```

Generates PDF without uploading to ABC Financial - useful for testing.

### Health Check
```
GET /
```

Returns service status and configured clubs.

## 🔌 GHL Webhook Configuration

In your GHL workflow, add a webhook action:

**URL:** `https://your-service.onrender.com/ghl-trial-form`  
**Method:** POST  
**Content-Type:** JSON  

**Payload:**
```json
{
  "firstName": "{{contact.first_name}}",
  "lastName": "{{contact.last_name}}",
  "email": "{{contact.email}}",
  "phone": "{{contact.phone}}",
  "location_id": "{{location.id}}",
  "signatureUrl": "{{form.signature_url}}",
  ...
}
```

See [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed webhook configuration.

## 🐛 Troubleshooting

### Check Logs
```
Render Dashboard → Your Service → Logs
```

### Common Issues

**PDF not generating:**
- Missing required fields (firstName, lastName, email)
- Invalid signature URL
- Club not configured

**ABC upload failing:**
- Wrong API credentials
- Member doesn't exist in ABC yet
- Invalid club_id

**Wrong club identified:**
- Ensure `location_id` is sent in webhook
- Verify CLUBS config matches GHL location IDs

### Test Manually

```bash
curl -X POST https://your-service.onrender.com/ghl-trial-form \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test@test.com",
    "location_id": "uflpfHNpByAnaBLkQzu3"
  }'
```

## 📊 Monitoring

**What to monitor:**
- Success rate (target: >99%)
- Response time (target: <10s)
- ABC upload failures
- Service uptime

**Where:**
- Render Dashboard → Logs (real-time)
- Render Dashboard → Metrics (graphs)

## 🔄 Updates

Service automatically deploys when you push to GitHub:

```bash
git add .
git commit -m "Updated configuration"
git push
```

Render detects the change and deploys in ~2 minutes.

## 📁 Project Structure

```
pdf-service/
├── index.js              # Main server code
├── package.json          # Dependencies
├── .gitignore           # Git ignore rules
├── render.yaml          # Render configuration
├── README.md            # This file
├── SETUP_GUIDE.md       # Detailed setup instructions
├── ARCHITECTURE.md      # System design documentation
├── TEST_EXAMPLES.md     # Testing examples
└── QUICK_REFERENCE.md   # Essential commands
```

## 🛠️ Technology

- **Node.js** - JavaScript runtime
- **Express** - Web framework
- **Puppeteer** - PDF generation (headless Chrome)
- **Axios** - HTTP client for ABC API
- **Render** - Cloud hosting
- **GitHub** - Source control

## 📚 Documentation

- [Setup Guide](SETUP_GUIDE.md) - Step-by-step deployment
- [Architecture](ARCHITECTURE.md) - How it works
- [Test Examples](TEST_EXAMPLES.md) - Testing commands
- [Quick Reference](QUICK_REFERENCE.md) - Essential info

## 🆘 Support

**Issues?**
1. Check Render logs first
2. Review troubleshooting section
3. Test with minimal data
4. Verify environment variables

**Resources:**
- Render Dashboard: https://dashboard.render.com
- Render Docs: https://render.com/docs

## 📝 License

ISC

---

**Built for West Coast Strength**  
Automated document management for multi-location gyms
