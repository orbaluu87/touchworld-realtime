// ============================================================================
// Touch World - Shared Server State
// ============================================================================

const players = new Map();
const chatRateLimit = new Map();

// Cleanup expired chatRateLimit entries every 30s to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - 10000;
  for (const [key, ts] of chatRateLimit.entries()) {
    if (ts < cutoff) chatRateLimit.delete(key);
  }
}, 30000).unref();

module.exports = { players, chatRateLimit };
