// test/vip-referrals-admin.test.js
const { test } = require('node:test');
const assert = require('node:assert');
const express = require('express');
const router = require('../routes/vip-referrals-admin');

function appWith(stubStore) {
  router.__setStoreForTest(stubStore);
  const app = express();
  app.use(express.json());
  app.use('/api/admin/vip-referrals', router);
  return app;
}

async function call(app, method, path, body) {
  const http = require('http');
  const server = app.listen(0);
  const port = server.address().port;
  const data = body ? JSON.stringify(body) : null;
  const res = await new Promise((resolve, reject) => {
    const req = http.request({ port, path, method, headers: { 'Content-Type': 'application/json' } }, r => {
      let b = ''; r.on('data', c => b += c); r.on('end', () => resolve({ status: r.statusCode, json: b ? JSON.parse(b) : null }));
    });
    req.on('error', reject); if (data) req.write(data); req.end();
  });
  server.close();
  return res;
}

test('GET /submissions returns rows + counts', async () => {
  const app = appWith({
    listSubmissions: async () => ({ rows: [{ id: 's1' }], counts: { submissions: 1 } }),
  });
  const res = await call(app, 'GET', '/api/admin/vip-referrals/submissions');
  assert.equal(res.status, 200);
  assert.equal(res.json.counts.submissions, 1);
});

test('GET /submissions/:id returns detail', async () => {
  const app = appWith({
    getSubmission: async () => ({ submission: { id: 's1', status: 'partial' }, recipients: [{ id: 'r1' }] }),
  });
  const res = await call(app, 'GET', '/api/admin/vip-referrals/submissions/s1');
  assert.equal(res.json.submission.status, 'partial');
});
