class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

class UpstreamError extends Error {
  constructor(message, statusCode, details, code = "UPSTREAM_ERROR") {
    super(message);
    this.name = "UpstreamError";
    this.statusCode = statusCode;
    this.details = details;
    this.code = code;
  }
}

class ChatMockClient {
  constructor({ baseUrl, timeoutMs, apiKey }) {
    this.baseUrl = (baseUrl || "").replace(/\/+$/, "");
    this.timeoutMs = Number.isFinite(timeoutMs) ? timeoutMs : 900000;
    this.apiKey = apiKey || "key";
  }

  async chatCompletions(payload, overrideTimeoutMs) {
    return this.#request("/v1/chat/completions", {
      method: "POST",
      timeoutMs: overrideTimeoutMs || this.timeoutMs,
      body: payload
    });
  }

  async listModels() {
    return this.#request("/v1/models", {
      method: "GET",
      timeoutMs: 30000
    });
  }

  async health() {
    return this.#request("/health", {
      method: "GET",
      timeoutMs: 15000
    });
  }

  async traffic(limit = 100) {
    return this.#request(`/debug/traffic?limit=${encodeURIComponent(String(limit))}`, {
      method: "GET",
      timeoutMs: 15000
    });
  }

  async clearTraffic() {
    return this.#request("/debug/traffic", {
      method: "DELETE",
      timeoutMs: 15000
    });
  }

  async #request(path, { method, timeoutMs, body }) {
    const useTimeout = Number.isFinite(timeoutMs) && timeoutMs > 0;
    const controller = useTimeout ? new AbortController() : null;
    const timer = useTimeout ? setTimeout(() => controller.abort(), timeoutMs) : null;
    let response;

    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller ? controller.signal : undefined
      });
    } catch (error) {
      if (timer) {
        clearTimeout(timer);
      }
      if (error && error.name === "AbortError") {
        throw new TimeoutError(`Upstream request timed out after ${timeoutMs}ms.`);
      }
      throw new UpstreamError("Unable to reach ChatMock service.", 502, {
        reason: error && error.message ? error.message : "Unknown network error"
      });
    }

    if (timer) {
      clearTimeout(timer);
    }
    const textBody = await response.text();
    let parsedBody = null;

    if (textBody) {
      try {
        parsedBody = JSON.parse(textBody);
      } catch (_ignored) {
        parsedBody = { raw: textBody };
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        throw new UpstreamError(
          "Login required: authenticate ChatMock before running tests.",
          401,
          parsedBody,
          "LOGIN_REQUIRED"
        );
      }
      throw new UpstreamError(
        `ChatMock returned HTTP ${response.status}.`,
        response.status,
        parsedBody
      );
    }

    return parsedBody;
  }
}

module.exports = {
  ChatMockClient,
  TimeoutError,
  UpstreamError
};
