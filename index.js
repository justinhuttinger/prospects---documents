const express = require('express');
const axios = require('axios');
const app = express();

// Mount Click2Save webhook BEFORE the global JSON parser. The handler reads
// the raw body to verify HMAC; the route-local express.raw parser must run
// instead of (not after) the global express.json parser.
const click2saveHandler = require('./routes/click2save');
app.post('/webhook/click2save', express.raw({ type: 'application/json' }), click2saveHandler);

// Paychex Training transcript webhook — must mount BEFORE express.json so the
// route-local express.raw can capture zip bytes. The router internally guards
// the raw parser to zip mime-types and falls through to JSON for envelope
// payloads, which then hit the global express.json below.
app.use(require('./routes/paychex-training-webhook'));

app.use(express.json({ limit: '15mb' })); // photo payloads can run several MB as base64

// ---------------------------------------------------------------------------
// CORS for Online Join — MUST run before the catch-all routers below
// (vip-referrals / pt-intake / kiosk each register a router-level CORS
// middleware with NO path prefix, so any of them would otherwise intercept
// the OPTIONS preflight for our /api/online-join and /api/admin/online-join
// paths and respond with their own (more restrictive) headers).
// ---------------------------------------------------------------------------

// Public widget — called from westcoaststrength.com.
app.use('/api/online-join', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/online-join', require('./routes/online-join-public'));

// Admin — JWT required. CORS sits in front of the auth middleware so the
// browser preflight (no Authorization header) gets 204 instead of 401.
const requireAdmin = require('./middleware/require-admin');
app.use('/api/admin/online-join', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/admin/online-join', requireAdmin, require('./routes/online-join-admin'));

// VIP Referrals admin API — same CORS-then-auth pattern as online-join.
app.use('/api/admin/vip-referrals', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/admin/vip-referrals', requireAdmin, require('./routes/vip-referrals-admin'));

// Paychex Training admin API — same CORS-then-auth pattern as online-join.
app.use('/api/admin/paychex-training', (req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use('/api/admin/paychex-training', requireAdmin, require('./routes/paychex-training-admin'));

// Serve the public widget HTML (single source of truth — Elementor copy/paste
// + portal Preview tab both reference this URL). Iframe-friendly headers; no
// auth. The widget reads ?location= from the URL when no data-location is set.
app.get('/widget/online-join', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // Allow embedding from any origin — needed by the staff portal preview.
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *;");
  res.sendFile(__dirname + '/join-flow-widget.html');
});

// VIP Referrals consolidated widget — single template served from repo,
// replaces 14 static GHL copies. Audience param: ?audience=staff|member
app.get('/widget/vip-referrals', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.set('Cache-Control', 'no-store');
  // Allow embedding from any origin — same as online-join (GHL embed + portal preview).
  res.removeHeader('X-Frame-Options');
  res.setHeader('Content-Security-Policy', "frame-ancestors *;");
  res.sendFile(__dirname + '/vip-referrals-widget.html');
});

// Static assets referenced by the widget (background image, etc.). The
// widget is loaded cross-origin from Elementor, so CORS must be open.
app.use('/widget-assets', express.static(__dirname + '/widget-assets', {
  maxAge: '7d',
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
  },
}));

// Kiosk Waiver — the tablet flow behind kiosk.westcoaststrength.com. Mounted
// under its own prefix, and BEFORE the no-path routers below: each of those
// registers a CORS middleware with no path, so whichever is mounted first
// answers the OPTIONS preflight for every URL in the app.
app.use('/api/kiosk-waiver', require('./routes/kiosk-waiver'));

// VIP Referrals widget — public POST + employee dropdown source
app.use(require('./routes/vip-referrals'));

// PT Intake form — public POST that fans out to per-club GHL inbound webhook
app.use(require('./routes/pt-intake'));

// Tour Kiosk — read-only ABC lookup + tour-completed webhook fan-out
app.use(require('./routes/kiosk'));

// The ABC calls, the sanitizers, the waiver PDF and the club lookups all live
// in services/waiver so the GHL survey webhook below and the kiosk site
// (/api/kiosk-waiver) run one implementation of the sequence, not two.
const waiverClubs = require('./services/waiver/clubs');
const { processWaiverSubmission } = require('./services/waiver/flow');
const {
  addMemberAlert,
  uploadMemberPicture,
  postMemberCheckin,
} = require('./services/waiver/abc');

console.log('Loaded clubs:', waiverClubs.publicList().map(c => c.name).join(', '));

// ============================================
// STANDALONE CHECK-IN ENDPOINT
// ============================================
// Use this endpoint to check in a member directly
// POST /checkin with body: { clubNumber: "12345", memberId: "67890", stationId: "KIOSK1" }
app.post('/checkin', async (req, res) => {
  try {
    const { clubNumber, memberId, stationId } = req.body;

    if (!clubNumber || !memberId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: clubNumber and memberId are required'
      });
    }

    // The service takes the station id explicitly, so fall back to the club's
    // configured one when the caller does not name a station.
    const club = waiverClubs.byNumber(clubNumber);
    const result = await postMemberCheckin(clubNumber, memberId, {
      stationId: stationId || (club && club.stationId),
    });

    if (result.success) {
      res.json({
        success: true,
        message: `Check-in posted for member ${memberId} at club ${clubNumber}`,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// STANDALONE ALERT ENDPOINT
// ============================================
// Use this endpoint to add an alert to a member directly
// POST /alert with body: { clubNumber: "12345", memberId: "67890", text: "CUSTOM MESSAGE", color: "Purple" }
app.post('/alert', async (req, res) => {
  try {
    const { clubNumber, memberId, text, color, showOneTime, acknowledge } = req.body;

    if (!clubNumber || !memberId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: clubNumber and memberId are required'
      });
    }

    const result = await addMemberAlert(clubNumber, memberId, { text, color, showOneTime, acknowledge });

    if (result.success) {
      res.json({
        success: true,
        message: `Alert added for member ${memberId} at club ${clubNumber}`,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// STANDALONE PICTURE UPLOAD ENDPOINT
// ============================================
// POST /picture with body: { clubNumber: "12345", memberId: "67890", image: "<base64>" }
app.post('/picture', async (req, res) => {
  try {
    const { clubNumber, memberId, image } = req.body;

    if (!clubNumber || !memberId || !image) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields: clubNumber, memberId, and image are required'
      });
    }

    const result = await uploadMemberPicture(clubNumber, memberId, image);

    if (result.success) {
      res.json({
        success: true,
        message: `Picture uploaded for member ${memberId} at club ${clubNumber}`,
        data: result.data
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// Main webhook handler
// Main webhook handler — GoHighLevel survey submissions.
//
// The kiosk site (/api/kiosk-waiver/submit) runs the exact same pipeline with a
// payload it builds itself; both call processWaiverSubmission so there is one
// implementation of the ABC sequence, not two that drift.
app.post('/webhook/ghl-form', async (req, res) => {
  try {
    console.log('=== GHL WEBHOOK RECEIVED ===');
    console.log(JSON.stringify(req.body, null, 2));

    const result = await processWaiverSubmission(req.body);

    console.log(`Processed for club ${result.clubName} (${result.clubNumber}), prospect ${result.prospectId}`);

    res.json({
      success: true,
      clubNumber: result.clubNumber,
      prospectId: result.prospectId,
      message: 'Prospect created, document uploaded, alert added, photo uploaded, and check-in posted successfully',
      abc_responses: result.steps
    });

  } catch (error) {
    console.error('Error processing webhook:', error.response?.data || error.message);

    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || error.abcResponse || null
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

module.exports = app;
