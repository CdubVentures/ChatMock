const express = require("express");
const request = require("supertest");
const extractRouter = require("../src/routes/extract");
const { UpstreamError } = require("../src/services/chatmockClient");

function buildApp(clientOverrides = {}, configOverrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.locals.chatmockClient = {
    chatCompletions: jest.fn(),
    listModels: jest.fn(),
    health: jest.fn(),
    traffic: jest.fn(),
    clearTraffic: jest.fn(),
    ...clientOverrides
  };

  app.locals.config = {
    chatmockBaseUrl: "http://chatmock:8000",
    chatmockTimeoutMs: 900000,
    ...configOverrides
  };

  app.use("/api", extractRouter);
  return app;
}

describe("extract routes", () => {
  test("GET /api/status returns connected when proxy health succeeds", async () => {
    const app = buildApp({
      health: jest.fn().mockResolvedValue({ status: "ok" })
    });

    const res = await request(app).get("/api/status").expect(200);
    expect(res.body.connected).toBe(true);
    expect(res.body.statusText).toMatch(/Connected to Proxy/i);
    expect(res.body.providerConfig.baseUrl).toBe("http://localhost:8000/v1");
  });

  test("GET /api/status returns disconnected when proxy health fails", async () => {
    const app = buildApp({
      health: jest.fn().mockRejectedValue(new Error("down"))
    });

    const res = await request(app).get("/api/status").expect(200);
    expect(res.body.connected).toBe(false);
    expect(res.body.statusText).toMatch(/Proxy unreachable/i);
  });

  test("GET /api/models merges live model list with fallback models", async () => {
    const app = buildApp({
      listModels: jest.fn().mockResolvedValue({
        data: [{ id: "gpt-5-high" }, { id: "custom-model-1" }]
      })
    });

    const res = await request(app).get("/api/models").expect(200);
    expect(res.body.source).toBe("chatmock");
    expect(res.body.models).toContain("gpt-5-high");
    expect(res.body.models).toContain("custom-model-1");
    expect(res.body.models).toContain("gpt-4o");
  });

  test("POST /api/test-extract validates required inputText", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/test-extract")
      .field("model", "gpt-5-high")
      .field("inputText", "")
      .expect(400);

    expect(res.body.error).toMatch(/inputText is required/i);
  });

  test("POST /api/test-extract returns formatted payload on success", async () => {
    const app = buildApp({
      chatCompletions: jest.fn().mockResolvedValue({
        id: "chatcmpl-x",
        choices: [
          {
            message: {
              role: "assistant",
              content: "{\"items\":[{\"name\":\"alpha\",\"score\":1}]}"
            }
          }
        ]
      })
    });

    const res = await request(app)
      .post("/api/test-extract")
      .field("model", "gpt-5-high")
      .field("inputText", "extract table")
      .field("aggressiveMode", "true")
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.forwardedRequest.endpointExternal).toBe("http://localhost:8000/v1/chat/completions");
    expect(res.body.parsedJson).toEqual({ items: [{ name: "alpha", score: 1 }] });
    expect(res.body.renderMode).toBe("table");
  });

  test("POST /api/queue-test reports per-request failures for upstream errors", async () => {
    const app = buildApp({
      chatCompletions: jest
        .fn()
        .mockRejectedValue(new UpstreamError("Login required", 401, { error: "auth" }, "LOGIN_REQUIRED"))
    });

    const res = await request(app)
      .post("/api/queue-test")
      .send({ requestCount: 3, model: "gpt-5-high", inputText: "queue test" })
      .expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.requestCount).toBe(3);
    expect(res.body.summary.failed).toBe(3);
    expect(res.body.resultsById).toHaveLength(3);
    expect(res.body.resultsById[0].statusCode).toBe(401);
  });
});
