# Deploying the WCS web app

The web app is a separate **Render Static Site** that lives alongside the
existing `prospects-documents` Web Service. The two are independent — the
Web Service stays exactly as it is today; only the new static site is
created.

## One-time Render setup

1. Push this repo to GitHub (already done).
2. In the Render dashboard, **New → Static Site**, point at the
   `prospects---documents` GitHub repo.
3. Configure:
   - **Branch:** `main`
   - **Root Directory:** `web`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
   - (optional) **Build Filter (Advanced → Auto-Deploy):** include only
     `web/**` so unrelated backend commits don't trigger frontend deploys.
4. Click **Create Static Site**. First build takes 1–2 min.
5. Once the initial site is up at `<your-site>.onrender.com`, attach
   custom domains (next section).

The default Render free Static Site tier comes with global CDN, automatic
SSL via Let's Encrypt, and SPA-friendly routing through `public/_redirects`
(already committed: `/* → /index.html 200`).

## Custom domains per gym

Each gym's domain attaches to the **same** static site — the frontend's
`HOST_MAP` in `src/lib/clubs.js` maps each apex/subdomain to a slug.

For each gym (Salem, Keizer, Eugene, Milwaukie, Clackamas, Springfield,
Medford):

1. **Render dashboard → Static Site → Settings → Custom Domains → Add**.
2. Enter the subdomain you want to use, e.g. `tour.wcssalem.app`.
   (Keep the apex like `wcssalem.app` pointed at GHL so existing pages
   keep working.)
3. Render will display the DNS target (CNAME or ALIAS to
   `<your-site>.onrender.com`).
4. At the gym's DNS host, add the matching CNAME record. Wait a few
   minutes for DNS propagation; Render auto-issues SSL once it resolves.

If you want a different subdomain per gym (e.g. `kiosk.wcssalem.app`),
update `HOST_MAP` in `src/lib/clubs.js`. Apex domains are also supported —
just point the apex at Render via ALIAS/ANAME or A records.

## Existing Render service is untouched

This deploy adds a *new* Render service. It does **not**:
- Modify the `prospects-documents` Web Service settings.
- Add a `render.yaml` blueprint to the repo (which would trigger a
  re-import of all services). The existing Web Service was created via
  the Render UI and stays that way.
- Change any environment variables on the existing service.

The new Static Site has zero env vars by default. The frontend hardcodes
`https://prospects-documents.onrender.com` as the API base; override at
build time by setting `VITE_API_BASE` in the Static Site env.

## What needs configuring inside GHL before launch

For each gym, create the inbound webhook URLs and paste them into
`clubs-config.json` in this repo (commits to `main` redeploy the Web
Service automatically):

| Field                       | Used by                          | When required                  |
|-----------------------------|----------------------------------|--------------------------------|
| `vipReferralWebhookUrl`     | `/webhooks/vip-referrals`        | All gyms — already configured for 6 of 7 (Milwaukie pending). |
| `ptIntakeWebhookUrl`        | `/webhooks/pt-intake`            | Per gym — empty by default.    |
| `tourCompletedWebhookUrl`   | `/webhooks/tour-completed`       | Per gym — empty by default.    |

Until each URL is filled in, the matching endpoint returns
`{ ok: false, error: 'missing_inbound_webhook_url' }` cleanly. Other gyms
keep working.

## Local testing of the production endpoints

```bash
cd web
npm install
VITE_API_BASE=https://prospects-documents.onrender.com npm run dev
# http://localhost:5173?location=salem
```

To test a different gym's branding/data without DNS changes, append
`?location=keizer` (or any slug) to the URL — `lib/clubs.js` falls back
to the query string when the hostname doesn't match.
