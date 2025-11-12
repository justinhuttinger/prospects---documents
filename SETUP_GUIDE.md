# 🚀 Setup Guide - Direct GHL Webhook Integration

## Overview

This service receives form submissions directly from GoHighLevel webhooks, generates professional PDFs, and uploads them to ABC Financial - all automatically with **no Zapier required**.

**Flow:**
```
GHL Form Submission → GHL Workflow Webhook → Your PDF Service → ABC Financial API
```

---

## Step 1: Create GitHub Repository

1. Go to https://github.com/new
2. Repository name: `wcs-pdf-service`
3. **Don't initialize** with README (we have files already)
4. Click "Create repository"

---

## Step 2: Upload Your Files

Download the `pdf-service` folder, then:

```bash
# Navigate to the folder
cd pdf-service

# Initialize git
git init

# Add your files
git add .

# Commit
git commit -m "Initial PDF service setup"

# Add your GitHub repo as remote (replace with your URL)
git remote add origin https://github.com/YOUR_USERNAME/wcs-pdf-service.git

# Push to GitHub
git branch -M main
git push -u origin main
```

---

## Step 3: Configure Your Clubs

Edit `index.js` (lines 10-30) and update with your actual data:

```javascript
const CLUBS = {
  'salem': {
    name: 'West Coast Strength Salem',
    location_id: 'uflpfHNpByAnaBLkQzu3',  // From GHL
    club_id: 'SALEM_ABC_CLUB_ID'          // From ABC Financial
  },
  'keizer': {
    name: 'West Coast Strength Keizer',
    location_id: 'YOUR_KEIZER_GHL_ID',
    club_id: 'YOUR_KEIZER_ABC_ID'
  }
  // Add all 7 clubs
};
```

**Where to find these IDs:**

**location_id (GHL):**
- Option 1: Submit a test form and check the webhook payload
- Option 2: Look at email headers - `X-Mailgun-Tag: loc_XXXXXXXXX`
- Option 3: GHL Settings → Locations → Copy Location ID

**club_id (ABC Financial):**
- Check your ABC Financial documentation
- Or ask your ABC Financial rep
- Format varies by ABC setup

---

## Step 4: Deploy to Render

1. Go to https://dashboard.render.com/
2. Click "New +" → "Web Service"
3. Connect GitHub (if not already)
4. Select your `wcs-pdf-service` repo
5. Click "Connect"

**Configuration:**
- **Name**: `wcs-pdf-service`
- **Environment**: `Node`
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Plan**: Free (or paid if needed)

**Environment Variables** (click "Advanced"):
```
ABC_API_URL = https://your-abc-api-endpoint.com/documents/upload
ABC_API_KEY = your_abc_api_key_here
NODE_ENV = production
```

6. Click "Create Web Service"
7. Wait ~5 minutes for deployment

Your service URL: `https://wcs-pdf-service.onrender.com`

---

## Step 5: Test Your Service

```bash
# Health check
curl https://wcs-pdf-service.onrender.com/

# Test PDF generation (without ABC upload)
curl -X POST https://wcs-pdf-service.onrender.com/test-pdf-generation \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test@wcstrength.com",
    "phone": "+15035551234",
    "location_id": "uflpfHNpByAnaBLkQzu3"
  }'
```

You should get back JSON with a base64 PDF.

---

## Step 6: Configure GHL Webhooks

For each club location in GHL:

### Option A: Workflow Webhook (Recommended)

1. Go to **GHL → Automation → Workflows**
2. Find/Create your "Trial Form Submitted" workflow
3. Add action: **Send Webhook**
4. Configure:
   - **URL**: `https://wcs-pdf-service.onrender.com/ghl-trial-form`
   - **Method**: POST
   - **Content Type**: JSON
   - **Payload**:
   ```json
   {
     "firstName": "{{contact.first_name}}",
     "lastName": "{{contact.last_name}}",
     "email": "{{contact.email}}",
     "phone": "{{contact.phone}}",
     "streetAddress": "{{contact.address1}}",
     "city": "{{contact.city}}",
     "state": "{{contact.state}}",
     "postalCode": "{{contact.postal_code}}",
     "dob": "{{contact.date_of_birth}}",
     "location_id": "{{location.id}}",
     "signatureUrl": "{{form.signature_url}}",
     "submissionDate": "{{contact.date_added}}"
   }
   ```
   
5. Test the webhook
6. Save workflow

### Option B: Form-Level Webhook

1. Go to **GHL → Sites → Forms**
2. Edit your "Trial Form"
3. Click **Settings → Integrations**
4. Add **Webhook**:
   - **URL**: `https://wcs-pdf-service.onrender.com/ghl-trial-form`
   - **Method**: POST
5. Enable webhook
6. Test with a form submission

---

## Step 7: Verify Everything Works

1. Submit a test form from each club
2. Check Render logs: Dashboard → Your Service → Logs
3. Look for:
   ```
   Received webhook from GHL
   Processing form for West Coast Strength Salem
   PDF generated successfully
   Successfully uploaded to ABC Financial
   ```
4. Verify document appears in ABC Financial member account

---

## Troubleshooting

### PDF Not Generating

**Check Render Logs:**
```
Dashboard → wcs-pdf-service → Logs tab
```

**Common Issues:**
- Missing required fields (firstName, lastName, email)
- Invalid location_id (club not configured)
- Signature URL not accessible

**Solution:**
- Test with minimal data first
- Add more fields gradually
- Check GHL webhook payload format

### ABC Upload Failing

**Check Logs for:**
```
ABC Financial upload failed: [error message]
```

**Common Issues:**
- Wrong ABC_API_URL or ABC_API_KEY
- Member doesn't exist in ABC yet
- Invalid club_id

**Solution:**
- Verify environment variables in Render
- Test ABC API credentials independently
- Check ABC Financial documentation

### Wrong Club Identified

**Issue:** PDF generated for wrong location

**Solution:**
- Ensure location_id is sent in GHL webhook
- Verify CLUBS configuration in `index.js`
- Check if location_id matches between GHL and your config

### Webhook Not Triggering

**Check:**
1. GHL webhook is enabled
2. Workflow is active
3. URL is correct (no typos)
4. Render service is running (check dashboard)

**Test manually:**
```bash
curl -X POST https://wcs-pdf-service.onrender.com/ghl-trial-form \
  -H "Content-Type: application/json" \
  -d '{
    "firstName": "Test",
    "lastName": "User",
    "email": "test@test.com",
    "location_id": "uflpfHNpByAnaBLkQzu3"
  }'
```

---

## Monitoring

### View Real-Time Logs
```
Render Dashboard → wcs-pdf-service → Logs
```

### What to Monitor:
- ✅ "Successfully uploaded to ABC Financial" - Good!
- ⚠️ "PDF generated but ABC upload failed" - PDF worked, ABC didn't
- ❌ "Unable to identify club" - Check location_id
- ❌ "Error processing webhook" - Check data format

### Set Up Alerts

In Render:
1. Dashboard → Your Service → Settings
2. Scroll to "Notifications"
3. Add email/Slack for deploy failures

---

## Updating the Service

When you need to make changes:

```bash
cd pdf-service

# Make your changes to index.js or other files

# Commit and push
git add .
git commit -m "Updated clubs configuration"
git push

# Render automatically deploys the update
```

---

## Field Mapping Reference

GHL sends different field names depending on form/workflow setup. The service handles these automatically:

| Displayed As | Accepted Field Names |
|--------------|---------------------|
| First Name | `firstName`, `first_name`, `name` |
| Last Name | `lastName`, `last_name` |
| Email | `email`, `email_address` |
| Phone | `phone`, `phone_number`, `phoneNumber` |
| Street | `streetAddress`, `address`, `address1`, `street` |
| City | `city` |
| State | `state` |
| Postal Code | `postalCode`, `zip`, `zipCode`, `postal_code` |
| DOB | `dob`, `dateOfBirth`, `date_of_birth`, `birthdate` |
| Signature | `signatureUrl`, `signature`, `signature_url` |

---

## Next Steps

Once everything is working:

1. ✅ Roll out to all 7 clubs
2. ✅ Monitor for 1-2 weeks
3. ✅ Archive old Zapier workflows (if any)
4. ✅ Document for your team
5. ✅ Set up backup/monitoring

---

## Support & Resources

- **Render Dashboard**: https://dashboard.render.com
- **Render Logs**: Dashboard → Your Service → Logs
- **GitHub Repo**: Your repository URL
- **Service URL**: https://wcs-pdf-service.onrender.com

Need help? Check the logs first - they show exactly what's happening!
