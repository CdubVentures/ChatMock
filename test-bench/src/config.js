function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed === 0) {
    return 0;
  }
  if (parsed < 0) {
    return fallback;
  }
  return parsed;
}

function normalizeUrl(url, fallback) {
  const candidate = (url || fallback || "").trim();
  return candidate.replace(/\/+$/, "");
}

function createConfig(env) {
  return {
    port: toPositiveInteger(env.PORT, 4000),
    chatmockBaseUrl: normalizeUrl(env.CHATMOCK_BASE_URL, "http://chatmock:8000"),
    chatmockTimeoutMs: toPositiveInteger(env.CHATMOCK_TIMEOUT_MS, 900000),
    chatmockApiKey: (env.CHATMOCK_API_KEY || "key").trim(),
    asyncMaxInFlight: Math.max(1, toPositiveInteger(env.ASYNC_MAX_IN_FLIGHT, 1)),
    asyncQueueMaxDepth: Math.max(1, toPositiveInteger(env.ASYNC_QUEUE_MAX_DEPTH, 120)),
    asyncRetryMaxAttempts: Math.max(1, toPositiveInteger(env.ASYNC_RETRY_MAX_ATTEMPTS, 2)),
    asyncRetryBaseMs: Math.max(0, toPositiveInteger(env.ASYNC_RETRY_BASE_MS, 1500)),
    asyncRetryMaxDelayMs: Math.max(100, toPositiveInteger(env.ASYNC_RETRY_MAX_DELAY_MS, 45000)),
    asyncAuthCooldownMs: Math.max(1000, toPositiveInteger(env.ASYNC_AUTH_COOLDOWN_MS, 300000)),
    asyncChallengeCooldownMs: Math.max(1000, toPositiveInteger(env.ASYNC_CHALLENGE_COOLDOWN_MS, 90000)),
    asyncRateCooldownMs: Math.max(1000, toPositiveInteger(env.ASYNC_RATE_COOLDOWN_MS, 45000)),
    asyncDegradedCooldownMs: Math.max(1000, toPositiveInteger(env.ASYNC_DEGRADED_COOLDOWN_MS, 15000))
  };
}

module.exports = {
  createConfig
};
