const {
  ChatMockClient,
  TimeoutError,
  UpstreamError
} = require("../src/services/chatmockClient");

describe("ChatMockClient", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = undefined;
  });

  test("returns parsed JSON on success", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true, id: "abc123" })
    });

    const client = new ChatMockClient({
      baseUrl: "http://chatmock:8000",
      timeoutMs: 120000,
      apiKey: "key"
    });

    const response = await client.chatCompletions({ model: "gpt-5", messages: [] });
    expect(response).toEqual({ ok: true, id: "abc123" });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test("throws TimeoutError when request exceeds timeout", async () => {
    global.fetch = jest.fn().mockImplementation((_url, options) => {
      return new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });
    });

    const client = new ChatMockClient({
      baseUrl: "http://chatmock:8000",
      timeoutMs: 5,
      apiKey: "key"
    });

    await expect(client.chatCompletions({ model: "gpt-5", messages: [] }))
      .rejects
      .toBeInstanceOf(TimeoutError);
  });

  test("throws login-required UpstreamError on 401", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => JSON.stringify({ error: { message: "Missing ChatGPT credentials" } })
    });

    const client = new ChatMockClient({
      baseUrl: "http://chatmock:8000",
      timeoutMs: 120000,
      apiKey: "key"
    });

    await expect(client.chatCompletions({ model: "gpt-5", messages: [] }))
      .rejects
      .toMatchObject({
        name: "UpstreamError",
        statusCode: 401,
        code: "LOGIN_REQUIRED"
      });
  });

  test("supports non-expiring timeout when timeoutMs is 0", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ ok: true })
    });
    const clearSpy = jest.spyOn(global, "clearTimeout");

    const client = new ChatMockClient({
      baseUrl: "http://chatmock:8000",
      timeoutMs: 0,
      apiKey: "key"
    });

    await client.chatCompletions({ model: "gpt-5", messages: [] });
    expect(clearSpy).toHaveBeenCalledTimes(0);
  });
});
