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
    chatmockApiKey: (env.CHATMOCK_API_KEY || "key").trim()
  };
}

module.exports = {
  createConfig
};
