# wcs-web

Static web app hosting WCS forms and (soon) the iPad tour kiosk. One Render
Static Site, multiple custom domains. The frontend detects which gym is
loading via `window.location.hostname` and feeds that slug through to
backend calls.

Stack matches `wcs-staff-portal/portal`:
- React 19 (plain JSX, no TypeScript)
- Vite 8
- Tailwind CSS v4 (CSS-side `@theme`, `@tailwindcss/vite` plugin)
- Inter font, navy + WCS red palette

## Routes (current)

| Path        | Description                                                    |
|-------------|----------------------------------------------------------------|
| `/`         | Landing page (placeholder until the tour kiosk lands)          |
| `/vip`      | VIP referrals (internal — Team Member dropdown shown)          |
| `/vipx`     | VIP referrals (member-facing — no Team Member field)           |

Both VIP routes hit the existing backend at
`https://prospects-documents.onrender.com`:
- `GET  /api/vip-referrals/employees?location=<slug>`
- `POST /webhooks/vip-referrals`

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

## Render Static Site config

- Root: repo root (or `web/` — set in Render UI).
- Build command: `cd web && npm install && npm run build`
- Publish directory: `web/dist`
- SPA rewrite: `/*  →  /index.html` (so `/vip`, `/vipx`, etc. resolve client-side).

Custom domains per gym attach to the same site. The `HOST_MAP` in
`src/lib/clubs.js` maps each domain to its slug.
