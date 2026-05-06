function defaultIsRetryable(err) {
  if (!err) return false;
  const code = err.code;
  if (code === 'ECONNRESET' || code === 'ETIMEDOUT' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
    return true;
  }
  const status = err.response && err.response.status;
  if (status === 429) return true;
  if (status >= 500 && status < 600) return true;
  return false;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryWithBackoff(fn, { attempts = 3, baseMs = 500, isRetryable = defaultIsRetryable } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i === attempts - 1) break;
      if (!isRetryable(err)) break;
      await sleep(baseMs * Math.pow(2, i));
    }
  }
  throw lastErr;
}

module.exports = { retryWithBackoff, defaultIsRetryable };
