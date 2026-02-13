const { AsyncQueueManager } = require("../src/services/async/queueManager");
const { ERROR_CODES } = require("../src/services/async/errorCodes");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClientMock({ failFirst = false, delayMs = 5 } = {}) {
  let callCount = 0;
  return {
    async chatCompletions(payload) {
      callCount += 1;
      await sleep(delayMs);
      if (failFirst && callCount === 1) {
        const err = new Error("upstream timeout");
        err.name = "TimeoutError";
        throw err;
      }
      return {
        id: `resp-${callCount}`,
        model: payload.model,
        choices: [{ message: { role: "assistant", content: `ok-${payload.model}` } }]
      };
    }
  };
}

describe("AsyncQueueManager", () => {
  test("prioritizes interactive over batch jobs", async () => {
    const executionOrder = [];
    const client = {
      async chatCompletions(payload) {
        executionOrder.push(payload.metaId);
        await sleep(3);
        return { choices: [{ message: { content: payload.metaId } }] };
      }
    };
    const queue = new AsyncQueueManager({
      client,
      maxInFlight: 1,
      maxQueueDepth: 20
    });

    const a = queue.submit({
      payload: { model: "gpt-5-high", messages: [], metaId: "batch-1" },
      priority: "batch"
    });
    const b = queue.submit({
      payload: { model: "gpt-5-high", messages: [], metaId: "interactive-1" },
      priority: "interactive"
    });

    await Promise.all([
      queue.waitForCompletion(a.job_id, 2000),
      queue.waitForCompletion(b.job_id, 2000)
    ]);

    expect(executionOrder[0]).toBe("interactive-1");
    expect(executionOrder[1]).toBe("batch-1");
  });

  test("returns deterministic backpressure code when queue is full", () => {
    const queue = new AsyncQueueManager({
      client: createClientMock({ delayMs: 100 }),
      maxInFlight: 1,
      maxQueueDepth: 1
    });

    queue.submit({ payload: { model: "gpt-5-high", messages: [] }, priority: "batch" });
    expect(() =>
      queue.submit({ payload: { model: "gpt-5-high", messages: [] }, priority: "batch" })
    ).toThrow(ERROR_CODES.QUEUE_BACKPRESSURE);
  });

  test("retries transient failures and eventually completes", async () => {
    const queue = new AsyncQueueManager({
      client: createClientMock({ failFirst: true, delayMs: 1 }),
      maxInFlight: 1,
      maxQueueDepth: 10,
      retryPolicy: {
        maxAttempts: 2,
        baseDelayMs: 1
      }
    });

    const job = queue.submit({
      payload: { model: "gpt-5-high", messages: [] },
      priority: "batch"
    });

    const result = await queue.waitForCompletion(job.job_id, 3000);
    expect(result.status).toBe("completed");
    expect(result.result.diagnostics.attempts).toBe(2);
  });

  test("supports cancel for queued job", async () => {
    const queue = new AsyncQueueManager({
      client: createClientMock({ delayMs: 40 }),
      maxInFlight: 1,
      maxQueueDepth: 20
    });

    const running = queue.submit({
      payload: { model: "gpt-5-high", messages: [] },
      priority: "interactive"
    });
    const queued = queue.submit({
      payload: { model: "gpt-5-high", messages: [] },
      priority: "batch"
    });

    const cancelResult = queue.cancel(queued.job_id);
    expect(cancelResult.cancelled).toBe(true);

    const finishedRunning = await queue.waitForCompletion(running.job_id, 3000);
    expect(finishedRunning.status).toBe("completed");
    const cancelled = queue.getResult(queued.job_id);
    expect(cancelled.status).toBe("cancelled");
  });

  test("provides queue depth visibility snapshot", () => {
    const queue = new AsyncQueueManager({
      client: createClientMock({ delayMs: 10 }),
      maxInFlight: 1,
      maxQueueDepth: 20
    });
    queue.submit({
      payload: { model: "gpt-5-high", messages: [] },
      priority: "interactive"
    });
    queue.submit({
      payload: { model: "gpt-5-high", messages: [] },
      priority: "batch"
    });
    const snapshot = queue.getQueueSnapshot();
    expect(snapshot.depth.total).toBeGreaterThanOrEqual(1);
    expect(snapshot.depth.by_priority).toHaveProperty("interactive");
    expect(snapshot.depth.by_priority).toHaveProperty("batch");
  });
});
