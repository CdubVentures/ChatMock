const { ERROR_CODES, classifyError, buildApiError } = require("../src/services/async/errorCodes");
const { UpstreamError, TimeoutError } = require("../src/services/chatmockClient");

describe("deterministic error codes", () => {
  test("maps timeout to UPSTREAM_TIMEOUT with retryable=true", () => {
    const info = classifyError(new TimeoutError("timed out"));
    expect(info.code).toBe(ERROR_CODES.UPSTREAM_TIMEOUT);
    expect(info.retryable).toBe(true);
  });

  test("maps login required to UPSTREAM_LOGIN_REQUIRED", () => {
    const info = classifyError(new UpstreamError("login", 401, {}, "LOGIN_REQUIRED"));
    expect(info.code).toBe(ERROR_CODES.UPSTREAM_LOGIN_REQUIRED);
    expect(info.retryable).toBe(false);
  });

  test("maps 429 to UPSTREAM_RATE_LIMITED with retryable=true", () => {
    const info = classifyError(new UpstreamError("rate limited", 429, {}, "UPSTREAM_ERROR"));
    expect(info.code).toBe(ERROR_CODES.UPSTREAM_RATE_LIMITED);
    expect(info.retryable).toBe(true);
  });

  test("maps upstream 5xx to UPSTREAM_UNAVAILABLE with explicit 503", () => {
    const info = classifyError(new UpstreamError("service down", 500, {}, "UPSTREAM_ERROR"));
    expect(info.code).toBe(ERROR_CODES.UPSTREAM_UNAVAILABLE);
    expect(info.status).toBe(503);
    expect(info.retryable).toBe(true);
  });

  test("maps upstream 4xx to UPSTREAM_BAD_RESPONSE with explicit 424", () => {
    const info = classifyError(new UpstreamError("bad request", 400, {}, "UPSTREAM_ERROR"));
    expect(info.code).toBe(ERROR_CODES.UPSTREAM_BAD_RESPONSE);
    expect(info.status).toBe(424);
    expect(info.retryable).toBe(false);
  });

  test("buildApiError returns stable shape", () => {
    const err = buildApiError({
      code: ERROR_CODES.JOB_NOT_FOUND,
      message: "Job not found",
      status: 404
    });
    expect(err.error.code).toBe(ERROR_CODES.JOB_NOT_FOUND);
    expect(err.error.message).toMatch(/not found/i);
    expect(err.status).toBe(404);
  });
});
