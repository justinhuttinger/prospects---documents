# 🎉 Getting Started - Direct GHL Integration

## What You Have

A complete PDF generation service that:
- ✅ Receives webhooks **directly from GoHighLevel**
- ✅ Generates professional PDFs with signatures
- ✅ Uploads to ABC Financial automatically
- ✅ **No Zapier required!**

## The New Flow

```
┌──────────────┐
│     GHL      │ Customer submits trial form
│   Workflow   │
└──────┬───────┘
       │
       │ Webhook (HTTP POST)
       ▼
┌──────────────┐
│  Your PDF    │ 1. Generates PDF
│   Service    │ 2. Uploads to ABC
└──────────────┘
   All automatic!
```

## What Changed From Before

**No More:**
- ❌ Zapier subscription
- ❌ Email parsing
- ❌ Manual Zap configuration
- ❌ Third-party dependencies

**Now:**
- ✅ Direct webhooks
- ✅ Instant processing
- ✅ Complete control
- ✅ Free (or $7/mo on Render)

## Quick Start (3 Steps)

### 1. Deploy to Render (5 minutes)

```bash
# Upload files to GitHub
cd pdf-service
git init
git add .
git commit -m "Initial setup"
git remote add origin https://github.com/YOUR_USERNAME/wcs-pdf-service.git
git push -u origin main

# Then deploy on Render:
# - Connect GitHub repo
# - Add environment variables (ABC_API_URL, ABC_API_KEY)
# - Click deploy
```

### 2. Configure Your Clubs (2 minutes)

Edit `index.js`:
```javascript
const CLUBS = {
  'salem': {
    name: 'West Coast Strength Salem',
    location_id: 'uflpfHNpByAnaBLkQzu3',  // From GHL
    club_id: 'YOUR_ABC_CLUB_ID'            // From ABC Financial
  },
  // Add all 7 clubs...
};
```

### 3. Set Up GHL Webhook (3 minutes)

In each GHL workflow:
1. Add "Send Webhook" action
2. URL: `https://your-service.onrender.com/ghl-trial-form`
3. Method: POST
4. Payload: Map your form fields
5. Test it!

**Done!** 🎉

## What Each File Does

| File | Purpose |
|------|---------|
| `index.js` | Main code - handles webhooks, generates PDFs, uploads to ABC |
| `package.json` | Lists dependencies (Express, Puppeteer, Axios) |
| `README.md` | Project overview |
| `SETUP_GUIDE.md` | **START HERE** - Detailed deployment steps |
| `ARCHITECTURE.md` | How the system works (great for understanding) |
| `TEST_EXAMPLES.md` | Commands to test everything |
| `QUICK_REFERENCE.md` | Cheat sheet for common tasks |

## Your Deployment Checklist

- [ ] Create GitHub repository
- [ ] Push code to GitHub
- [ ] Create Render account (if needed)
- [ ] Deploy service on Render
- [ ] Add environment variables (ABC_API_URL, ABC_API_KEY)
- [ ] Get location_id for all 7 clubs from GHL
- [ ] Get club_id for all 7 clubs from ABC Financial
- [ ] Update CLUBS configuration in `index.js`
- [ ] Test with `/test-pdf-generation` endpoint
- [ ] Configure webhook in GHL workflow (one club first)
- [ ] Submit test form
- [ ] Verify PDF in ABC Financial
- [ ] Roll out to remaining clubs
- [ ] Monitor logs for 24-48 hours
- [ ] Archive old Zapier workflows (if any)

## Testing Strategy

**Phase 1: Local Testing**
```bash
npm install
npm start
curl http://localhost:3000/
```

**Phase 2: PDF Generation**
```bash
curl -X POST http://localhost:3000/test-pdf-generation \
  -d '{"firstName":"Test","lastName":"User","email":"test@test.com"}'
```

**Phase 3: One Club**
- Deploy to Render
- Configure Salem webhook only
- Submit 2-3 test forms
- Verify in ABC Financial

**Phase 4: All Clubs**
- Configure remaining 6 clubs
- Monitor for issues
- Celebrate! 🎉

## Common Questions

### Q: What if ABC upload fails?
**A:** The service returns a partial success - PDF was generated but not uploaded. You can see the error in Render logs and manually upload if needed. The service will retry on next submission.

### Q: Can I customize the PDF layout?
**A:** Yes! Edit the `buildTrialFormHTML` function in `index.js`. The HTML/CSS is straightforward to modify.

### Q: How do I add more form types (waivers, medical forms)?
**A:** Duplicate the main endpoint, create a new HTML template function, and point a new GHL webhook to it. Each form type gets its own endpoint.

### Q: What if signature URL is invalid?
**A:** PDF will still generate, but signature section will be empty or show an error placeholder. Check Render logs for details.

### Q: How much does this cost?
**A:** Render free tier works for moderate volume. If you need more power: $7/mo for their starter plan. No Zapier subscription needed!

### Q: Can I use this for other gyms?
**A:** Absolutely! The code is generic. Just update the CLUBS configuration and ABC API settings.

## Support Resources

**Documentation:**
- [SETUP_GUIDE.md](SETUP_GUIDE.md) - Full deployment walkthrough
- [ARCHITECTURE.md](ARCHITECTURE.md) - System design
- [TEST_EXAMPLES.md](TEST_EXAMPLES.md) - Testing commands
- [QUICK_REFERENCE.md](QUICK_REFERENCE.md) - Quick commands

**Live System:**
- Render Dashboard: https://dashboard.render.com
- Render Logs: Real-time debugging
- GitHub Repo: Source code

**Need Help?**
1. Check Render logs first (they show everything)
2. Review troubleshooting section in SETUP_GUIDE.md
3. Test with minimal data to isolate the issue
4. Check environment variables are set correctly

## What's Next?

After getting this working, you could:
- Add more form types (waivers, medical)
- Set up email notifications on failures
- Create an admin dashboard
- Store PDFs in S3 as backup
- Add retry logic for failed uploads

But for now, just get it working with trial forms first!

## Pro Tips

1. **Start with one club** - Don't configure all 7 at once
2. **Use test endpoint first** - `/test-pdf-generation` doesn't upload to ABC
3. **Check logs constantly** - They tell you exactly what's happening
4. **Keep backups** - Git commit before making changes
5. **Test thoroughly** - Submit multiple test forms before going live

## Ready?

Read [SETUP_GUIDE.md](SETUP_GUIDE.md) for detailed step-by-step instructions.

Let's get this deployed! 🚀
