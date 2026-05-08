# wcs-web

Static web app hosting WCS forms and the iPad tour kiosk. One Render
Static Site, multiple custom domains. The frontend detects which gym is
loading via `window.location.hostname` and feeds that slug through to
backend calls on the existing `prospects-documents` Web Service.

Stack matches `wcs-staff-portal/portal`:
- React 19 (plain JSX, no TypeScript)
- Vite 8
- Tailwind CSS v4 (CSS-side `@theme`, `@tailwindcss/vite` plugin)
- Inter font, navy + WCS red palette

## Routes

| Path          | Description                                                    |
|---------------|----------------------------------------------------------------|
| `/`           | Landing page with links to every form                          |
| `/tour`       | iPad tour kiosk — multi-step intake flow                       |
| `/kiosk`      | Alias for `/tour`                                               |
| `/vip`        | VIP referrals (internal — Team Member dropdown shown)          |
| `/vipx`       | VIP referrals (member-facing — no Team Member field)           |
| `/form-page`  | PT intake form                                                  |

All routes call the existing backend at
`https://prospects-documents.onrender.com`. The kiosk's final submit
hits `/webhooks/tour-completed`; the new-member ABC creation flow hits
the existing `/webhook/ghl-form` unchanged.

## Local dev

```bash
cd web
npm install
npm run dev   # http://localhost:5173
```

To simulate a gym locally, append `?location=salem` (or any slug) to the URL —
`lib/clubs.js` falls back to the query string when the hostname doesn't match.

## Build

```bash
npm run build   # outputs to web/dist
```

## Deploy

See [DEPLOY.md](./DEPLOY.md) for full step-by-step Render Static Site setup
and per-gym custom-domain configuration.

Quick reference:
- **Root directory:** `web`
- **Build command:** `npm install && npm run build`
- **Publish directory:** `dist`
- **SPA rewrite:** `/*  →  /index.html` (handled by `public/_redirects`)

## iPad polish

- `index.html` — viewport pinned (no zoom), `apple-mobile-web-app-capable`, theme color WCS red.
- `public/manifest.json` — PWA manifest so the kiosk launches in standalone (no Safari chrome) when added to Home Screen.
- `public/_redirects` — SPA fallback for client-side routing.
- `public/ICONS.md` — instructions for the two PNG assets you need (`wcs-logo.png` 192×192 and `apple-touch-icon.png` 180×180).
