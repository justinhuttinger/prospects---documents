const crypto = require('crypto');

function verifySignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader || typeof signatureHeader !== 'string') return false;
  if (!signatureHeader.startsWith('sha256=')) return false;

  const received = signatureHeader.slice(7);
  const computed = crypto
    .createHmac('sha256', secret)
    .update(rawBody, 'utf8')
    .digest('hex');

  if (received.length !== computed.length) return false;

  try {
    return crypto.timingSafeEqual(
      Buffer.from(received, 'hex'),
      Buffer.from(computed, 'hex')
    );
  } catch {
    return false;
  }
}

function isFresh(timestampHeader, windowSec = 300, nowSec = Math.floor(Date.now() / 1000)) {
  const ts = parseInt(timestampHeader, 10);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowSec - ts) <= windowSec;
}

module.exports = { verifySignature, isFresh };
