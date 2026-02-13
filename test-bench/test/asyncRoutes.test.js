const express = require("express");
const request = require("supertest");
const asyncRouter = require("../src/routes/asyncControl");
const { UpstreamError } = require("../src/services/chatmockClient");

function buildApp(controlPlaneOverrides = {}) {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.locals.asyncControlPlane = {
    submit: jest.fn(),
    getStatus: jest.fn(),
    getResult: jest.fn(),
    cancel: jest.fn(),
    getQueueSnapshot: jest.fn(),
    getState: jest.fn(),
    getMetrics: jest.fn(),
    getReviewPayload: jest.fn(),
    runReplay: jest.fn(),
    ...controlPlaneOverrides
  };

  app.use("/api", asyncRouter);
  return app;
}

describe("async control routes", () => {
  test("POST /api/async/submit returns job and links", async () => {
    const app = buildApp({
      submit: jest.fn().mockReturnValue({
        job_id: "job-1",
        status: "queued",
        links: {
          status: "/api/async/status/job-1",
          result: "/api/async/result/job-1",
          cancel: "/api/async/cancel/job-1"
        }
      })
    });

    const res = await request(app)
      .post("/api/async/submit")
      .send({
        payload: { model: "gpt-5-high", messages: [{ role: "user", content: "hello" }] },
        priority: "interactive"
      })
      .expect(202);

    expect(res.body.job_id).toBe("job-1");
    expect(res.body.links.status).toContain("/status/job-1");
  });

  test("GET /api/async/status/:jobId returns current status", async () => {
    const app = buildApp({
      getStatus: jest.fn().mockReturnValue({
        job_id: "job-2",
        status: "running"
      })
    });
    const res = await request(app).get("/api/async/status/job-2").expect(200);
    expect(res.body.status).toBe("running");
  });

  test("POST /api/async/cancel/:jobId returns deterministic cancel payload", async () => {
    const app = buildApp({
      cancel: jest.fn().mockReturnValue({
        ok: true,
        job_id: "job-3",
        status: "cancelled"
      })
    });
    const res = await request(app).post("/api/async/cancel/job-3").expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.status).toBe("cancelled");
  });

  test("GET /api/async/state returns explicit sidecar state", async () => {
    const app = buildApp({
      getState: jest.fn().mockResolvedValue({
        state: "ready",
        reasons: []
      })
    });
    const res = await request(app).get("/api/async/state").expect(200);
    expect(res.body.state).toBe("ready");
  });

  test("GET /api/async/aggressive/report returns aggregate shape", async () => {
    const app = buildApp({
      getMetrics: jest.fn().mockReturnValue({
        metrics: {
          aggressive: {
            triggered: 3,
            improved: 2,
            win_rate: 2 / 3
          }
        }
      })
    });
    const res = await request(app).get("/api/async/aggressive/report").expect(200);
    expect(res.body.aggressive.triggered).toBe(3);
    expect(res.body.aggressive.improved).toBe(2);
  });

  test("POST /api/replay/run returns replay summary payload", async () => {
    const app = buildApp({
      runReplay: jest.fn().mockResolvedValue({
        replay_id: "replay-1",
        summary: {
          total_cases: 2,
          baseline_accuracy: 0.7,
          candidate_accuracy: 0.9,
          accuracy_delta: 0.2
        }
      })
    });
    const res = await request(app)
      .post("/api/replay/run")
      .send({
        replayName: "mouse-regression",
        baselineModel: "gpt-4o",
        candidateModel: "gpt-5-high",
        cases: []
      })
      .expect(200);
    expect(res.body.replay_id).toBe("replay-1");
    expect(res.body.summary.accuracy_delta).toBeGreaterThan(0);
  });

  test("POST /api/replay/run maps upstream errors to deterministic code/status", async () => {
    const app = buildApp({
      runReplay: jest.fn().mockRejectedValue(new UpstreamError("upstream unavailable", 500, {}, "UPSTREAM_ERROR"))
    });
    const res = await request(app)
      .post("/api/replay/run")
      .send({
        replayName: "mouse-regression",
        baselineModel: "gpt-4o",
        candidateModel: "gpt-5-high",
        cases: [{ id: "1", payload: { messages: [] }, expected: {} }]
      })
      .expect(503);
    expect(res.body.error.code).toBe("UPSTREAM_UNAVAILABLE");
  });
});
