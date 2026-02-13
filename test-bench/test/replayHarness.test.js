const { ReplayHarness, computeFieldScores } = require("../src/services/async/replayHarness");
const fs = require("fs");
const os = require("os");
const path = require("path");

describe("ReplayHarness helpers", () => {
  test("computeFieldScores calculates per-field match and accuracy", () => {
    const expected = { weight_g: 56, battery_h: 120, shape: "ergonomic" };
    const actual = { weight_g: 56, battery_h: 90, shape: "ergonomic" };
    const score = computeFieldScores(expected, actual);
    expect(score.total_fields).toBe(3);
    expect(score.matched_fields).toBe(2);
    expect(score.accuracy).toBeCloseTo(2 / 3, 4);
    expect(score.field_results.battery_h.match).toBe(false);
  });

  test("run() compares baseline vs candidate and returns field-level deltas", async () => {
    const queueManager = {
      async runInlineJob(request) {
        const model = request.payload.model;
        if (model === "baseline") {
          return {
            status: "completed",
            result: { parsed_json: { weight_g: 55, battery_h: 120 } }
          };
        }
        return {
          status: "completed",
          result: { parsed_json: { weight_g: 56, battery_h: 120 } }
        };
      }
    };

    const harness = new ReplayHarness({ queueManager });
    const report = await harness.run({
      replayName: "mouse-core",
      baselineModel: "baseline",
      candidateModel: "candidate",
      cases: [
        {
          id: "case-1",
          payload: { messages: [{ role: "user", content: "extract fields" }] },
          expected: { weight_g: 56, battery_h: 120 }
        }
      ]
    });

    expect(report.summary.total_cases).toBe(1);
    expect(report.summary.baseline_accuracy).toBeLessThan(report.summary.candidate_accuracy);
    expect(report.summary.accuracy_delta).toBeGreaterThan(0);
    expect(report.case_results[0].candidate.score.field_results.weight_g.match).toBe(true);
  });

  test("run() emits drift alert when candidate accuracy drops vs previous replay", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "chatmock-replay-"));
    try {
      let phase = "first";
      const queueManager = {
        async runInlineJob(request) {
          const model = request.payload.model;
          if (model === "baseline") {
            return {
              status: "completed",
              result: { parsed_json: { weight_g: 56, battery_h: 120 } }
            };
          }
          if (phase === "first") {
            return {
              status: "completed",
              result: { parsed_json: { weight_g: 56, battery_h: 120 } }
            };
          }
          return {
            status: "completed",
            result: { parsed_json: { weight_g: 1, battery_h: 1 } }
          };
        }
      };

      const harness = new ReplayHarness({ queueManager, reportsDir: tempDir });

      await harness.run({
        replayName: "mouse-core",
        baselineModel: "baseline",
        candidateModel: "candidate",
        cases: [
          {
            id: "case-1",
            payload: { messages: [{ role: "user", content: "extract fields" }] },
            expected: { weight_g: 56, battery_h: 120 }
          }
        ]
      });

      phase = "second";
      const second = await harness.run({
        replayName: "mouse-core",
        baselineModel: "baseline",
        candidateModel: "candidate",
        cases: [
          {
            id: "case-1",
            payload: { messages: [{ role: "user", content: "extract fields" }] },
            expected: { weight_g: 56, battery_h: 120 }
          }
        ]
      });

      expect(second.summary.drift_alerts.length).toBeGreaterThan(0);
      expect(second.summary.drift_alerts[0].type).toBe("accuracy_drop");
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
