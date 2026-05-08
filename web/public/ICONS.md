# Icon assets

Drop the following PNGs into `web/public/` before launching the kiosk.
Vite copies everything in `public/` straight into `dist/` at the root, so
both `index.html` and `manifest.json` reference them as absolute paths.

| Filename                | Size       | Used for                                          |
|-------------------------|------------|---------------------------------------------------|
| `wcs-logo.png`          | 192×192 PNG | Browser favicon, manifest 192-icon                |
| `apple-touch-icon.png`  | 180×180 PNG | iOS Home Screen webclip icon (rounded corners auto-applied by iOS) |

The staff portal already ships a `wcs-logo.png` at `wcs-staff-portal/portal/public/wcs-logo.png` — copy that in (or whichever final brand mark you want for these public-facing pages).

`apple-touch-icon.png` should be a solid-bg square version (no transparency) sized at 180×180. iOS 17+ also accepts PNGs without rounded corners — it'll round them itself.

Until both PNGs exist the page still loads fine; the browser just shows a default favicon and the iOS webclip falls back to a screenshot.
