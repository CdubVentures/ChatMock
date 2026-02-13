const { resolveSidecarState } = require("../src/services/async/stateResolver");

describe("resolveSidecarState", () => {
  test("returns ready when healthy and no active signals", () => {
    const state = resolveSidecarState({
      now: Date.now(),
      connectivityOk: true,
      signals: {},
      queueSnapshot: { depth: { total: 0 } },
      metricsSummary: { error_rate: 0 }
    });
    expect(state.state).toBe("ready");
  });

  test("returns auth_required when auth signal is active", () => {
    const now = Date.now();
    const state = resolveSidecarState({
      now,
      connectivityOk: true,
      signals: { auth_required_until: now + 10000 },
      queueSnapshot: { depth: { total: 0 } },
      metricsSummary: { error_rate: 0 }
    });
    expect(state.state).toBe("auth_required");
  });

  test("returns challenge over degraded when challenge signal exists", () => {
    const now = Date.now();
    const state = resolveSidecarState({
      now,
      connectivityOk: false,
      signals: { challenge_until: now + 10000 },
      queueSnapshot: { depth: { total: 5 } },
      metricsSummary: { error_rate: 0.5 }
    });
    expect(state.state).toBe("challenge");
  });

  test("returns rate_limited when rate-limit cooldown is active", () => {
    const now = Date.now();
    const state = resolveSidecarState({
      now,
      connectivityOk: true,
      signals: { rate_limited_until: now + 15000 },
      queueSnapshot: { depth: { total: 3 } },
      metricsSummary: { error_rate: 0.1 }
    });
    expect(state.state).toBe("rate_limited");
  });

  test("returns degraded when connectivity is down and no stronger signal", () => {
    const now = Date.now();
    const state = resolveSidecarState({
      now,
      connectivityOk: false,
      signals: {},
      queueSnapshot: { depth: { total: 0 } },
      metricsSummary: { error_rate: 0.2 }
    });
    expect(state.state).toBe("degraded");
  });
});
