const ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  JOB_NOT_FOUND: "JOB_NOT_FOUND",
  JOB_CANCELLED: "JOB_CANCELLED",
  QUEUE_BACKPRESSURE: "QUEUE_BACKPRESSURE",
  QUEUE_COOLDOWN_ACTIVE: "QUEUE_COOLDOWN_ACTIVE",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_LOGIN_REQUIRED: "UPSTREAM_LOGIN_REQUIRED",
  UPSTREAM_RATE_LIMITED: "UPSTREAM_RATE_LIMITED",
  UPSTREAM_CHALLENGE: "UPSTREAM_CHALLENGE",
  UPSTREAM_UNAVAILABLE: "UPSTREAM_UNAVAILABLE",
  UPSTREAM_BAD_RESPONSE: "UPSTREAM_BAD_RESPONSE",
  INTERNAL_ERROR: "INTERNAL_ERROR"
});

function buildApiError({ code, message, status = 500, details = null, retryable = false }) {
  return {
    status,
    error: {
      code: code || ERROR_CODES.INTERNAL_ERROR,
      message: message || "Unexpected error.",
      retryable: Boolean(retryable),
      details
    }
  };
}

function classifyError(error) {
  const msg = String((error && error.message) || "").toLowerCase();
  const statusCode = Number(error && error.statusCode);
  const upstreamCode = String((error && error.code) || "").toUpperCase();

  if (error && error.name === "TimeoutError") {
    return {
      code: ERROR_CODES.UPSTREAM_TIMEOUT,
      message: error.message || "Upstream request timed out.",
      status: 504,
      retryable: true
    };
  }

  if (statusCode === 401 || upstreamCode === "LOGIN_REQUIRED") {
    return {
      code: ERROR_CODES.UPSTREAM_LOGIN_REQUIRED,
      message: error.message || "Login required.",
      status: 401,
      retryable: false
    };
  }

  if (statusCode === 429 || msg.includes("rate limit")) {
    return {
      code: ERROR_CODES.UPSTREAM_RATE_LIMITED,
      message: error.message || "Upstream is rate limited.",
      status: 429,
      retryable: true
    };
  }

  if (msg.includes("just a moment") || msg.includes("challenge") || msg.includes("verify you are human")) {
    return {
      code: ERROR_CODES.UPSTREAM_CHALLENGE,
      message: error.message || "Upstream challenge page detected.",
      status: 503,
      retryable: true
    };
  }

  if (statusCode >= 500 && statusCode < 600) {
    return {
      code: ERROR_CODES.UPSTREAM_UNAVAILABLE,
      message: error.message || "Upstream unavailable.",
      status: 503,
      retryable: true
    };
  }

  if (Number.isFinite(statusCode) && statusCode >= 400) {
    return {
      code: ERROR_CODES.UPSTREAM_BAD_RESPONSE,
      message: error.message || `Upstream returned HTTP ${statusCode}.`,
      status: 424,
      retryable: false
    };
  }

  return {
    code: ERROR_CODES.INTERNAL_ERROR,
    message: error && error.message ? error.message : "Internal error.",
    status: 500,
    retryable: false
  };
}

module.exports = {
  ERROR_CODES,
  buildApiError,
  classifyError
};
