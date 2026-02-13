const fs = require("fs");
const path = require("path");

function normalizeValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === "number") {
    return Number(value);
  }
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase();
  }
  return JSON.stringify(value);
}

function computeFieldScores(expected, actual) {
  const expectedObj = expected && typeof expected === "object" ? expected : {};
  const actualObj = actual && typeof actual === "object" ? actual : {};
  const fieldResults = {};
  const fields = Object.keys(expectedObj);
  let matched = 0;
  for (const field of fields) {
    const left = normalizeValue(expectedObj[field]);
    const right = normalizeValue(actualObj[field]);
    const match = left === right;
    if (match) {
      matched += 1;
    }
    fieldResults[field] = {
      expected: expectedObj[field],
      actual: actualObj[field],
      match
    };
  }
  const total = fields.length;
  const accuracy = total > 0 ? matched / total : 0;
  return {
    total_fields: total,
    matched_fields: matched,
    accuracy,
    field_results: fieldResults
  };
}

class ReplayHarness {
  constructor({ queueManager, reportsDir = null }) {
    if (!queueManager || typeof queueManager.runInlineJob !== "function") {
      throw new Error("ReplayHarness requires queueManager.runInlineJob");
    }
    this.queueManager = queueManager;
    this.reportsDir = reportsDir;
  }

  async run({ replayName, baselineModel, candidateModel, cases }) {
    const reportId = `replay-${Date.now()}`;
    const normalizedCases = Array.isArray(cases) ? cases : [];
    const caseResults = [];

    for (const item of normalizedCases) {
      const payload = item && typeof item.payload === "object" ? { ...item.payload } : {};
      const expected = item && typeof item.expected === "object" ? item.expected : {};
      const id = item && item.id ? String(item.id) : `case-${caseResults.length + 1}`;

      const baselineEnvelope = await this.queueManager.runInlineJob({
        payload: { ...payload, model: baselineModel },
        priority: "batch",
        aggressive: { enabled: false }
      }, 900000);
      const candidateEnvelope = await this.queueManager.runInlineJob({
        payload: { ...payload, model: candidateModel },
        priority: "batch",
        aggressive: { enabled: false }
      }, 900000);

      const baselineParsed =
        baselineEnvelope && baselineEnvelope.result ? baselineEnvelope.result.parsed_json : null;
      const candidateParsed =
        candidateEnvelope && candidateEnvelope.result ? candidateEnvelope.result.parsed_json : null;
      const baselineScore = computeFieldScores(expected, baselineParsed);
      const candidateScore = computeFieldScores(expected, candidateParsed);

      caseResults.push({
        id,
        expected,
        baseline: { model: baselineModel, score: baselineScore, parsed_json: baselineParsed },
        candidate: { model: candidateModel, score: candidateScore, parsed_json: candidateParsed },
        accuracy_delta: candidateScore.accuracy - baselineScore.accuracy
      });
    }

    const baselineAcc = caseResults.length
      ? caseResults.reduce((acc, item) => acc + item.baseline.score.accuracy, 0) / caseResults.length
      : 0;
    const candidateAcc = caseResults.length
      ? caseResults.reduce((acc, item) => acc + item.candidate.score.accuracy, 0) / caseResults.length
      : 0;

    const report = {
      replay_id: reportId,
      replay_name: replayName || "default",
      created_at: new Date().toISOString(),
      summary: {
        total_cases: caseResults.length,
        baseline_model: baselineModel,
        candidate_model: candidateModel,
        baseline_accuracy: baselineAcc,
        candidate_accuracy: candidateAcc,
        accuracy_delta: candidateAcc - baselineAcc,
        drift_alerts: []
      },
      case_results: caseResults
    };

    if (this.reportsDir) {
      const outDir = path.resolve(this.reportsDir);
      fs.mkdirSync(outDir, { recursive: true });
      const safeName = String(replayName || "default").replace(/[^a-zA-Z0-9._-]+/g, "_");
      const latestPath = path.join(outDir, `latest-${safeName}.json`);
      if (fs.existsSync(latestPath)) {
        try {
          const previous = JSON.parse(fs.readFileSync(latestPath, "utf8"));
          const previousAcc =
            previous &&
            previous.summary &&
            Number.isFinite(Number(previous.summary.candidate_accuracy))
              ? Number(previous.summary.candidate_accuracy)
              : null;
          if (previousAcc !== null) {
            const delta = candidateAcc - previousAcc;
            if (delta <= -0.05) {
              report.summary.drift_alerts.push({
                level: "warn",
                type: "accuracy_drop",
                message: `Candidate accuracy dropped by ${(Math.abs(delta) * 100).toFixed(2)} percentage points vs previous run.`,
                previous_candidate_accuracy: previousAcc,
                current_candidate_accuracy: candidateAcc
              });
            }
          }
        } catch (_error) {
          // ignore malformed historical report
        }
      }
      fs.writeFileSync(path.join(outDir, `${reportId}.json`), JSON.stringify(report, null, 2), "utf8");
      fs.writeFileSync(latestPath, JSON.stringify(report, null, 2), "utf8");
    }

    return report;
  }
}

module.exports = {
  ReplayHarness,
  computeFieldScores
};
