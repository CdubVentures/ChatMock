const path = require("path");
const { AsyncQueueManager } = require("./queueManager");
const { ReplayHarness } = require("./replayHarness");
const { resolveSidecarState } = require("./stateResolver");
const { ERROR_CODES } = require("./errorCodes");

function normalizePriority(priority) {
  const normalized = String(priority || "").trim().toLowerCase();
  if (["interactive", "batch", "retry"].includes(normalized)) {
    return normalized;
  }
  return "batch";
}

class AsyncControlPlane {
  constructor({ chatmockClient, config }) {
    this.chatmockClient = chatmockClient;
    this.config = config;
    this.queue = new AsyncQueueManager({
      client: chatmockClient,
      maxInFlight: config.asyncMaxInFlight,
      maxQueueDepth: config.asyncQueueMaxDepth,
      retryPolicy: {
        maxAttempts: config.asyncRetryMaxAttempts,
        baseDelayMs: config.asyncRetryBaseMs,
        maxDelayMs: config.asyncRetryMaxDelayMs
      },
      cooldowns: {
        authRequiredMs: config.asyncAuthCooldownMs,
        challengeMs: config.asyncChallengeCooldownMs,
        rateLimitedMs: config.asyncRateCooldownMs,
        degradedMs: config.asyncDegradedCooldownMs
      }
    });
    this.replayHarness = new ReplayHarness({
      queueManager: this.queue,
      reportsDir: path.join(process.cwd(), "replay-reports")
    });
    this.latestReplayReports = new Map();
    this.latestReplayByName = new Map();
  }

  submit(requestBody) {
    const payload = requestBody && typeof requestBody.payload === "object" ? requestBody.payload : null;
    if (!payload) {
      const err = new Error("payload object is required");
      err.code = ERROR_CODES.INVALID_REQUEST;
      throw err;
    }
    return this.queue.submit({
      payload,
      priority: normalizePriority(requestBody.priority),
      aggressive: {
        enabled: Boolean(requestBody.aggressive && requestBody.aggressive.enabled),
        fallbackReason:
          requestBody.aggressive && typeof requestBody.aggressive.fallbackReason === "string"
            ? requestBody.aggressive.fallbackReason
            : null,
        confidenceBefore:
          requestBody.aggressive && Number.isFinite(Number(requestBody.aggressive.confidenceBefore))
            ? Number(requestBody.aggressive.confidenceBefore)
            : null
      },
      domAnchor: requestBody.domAnchor || null,
      screenshotRegion: requestBody.screenshotRegion || null,
      reasoningNote: requestBody.reasoningNote || null
    });
  }

  getStatus(jobId) {
    return this.queue.getStatus(jobId);
  }

  getResult(jobId) {
    return this.queue.getResult(jobId);
  }

  cancel(jobId) {
    return this.queue.cancel(jobId);
  }

  getQueueSnapshot() {
    return this.queue.getQueueSnapshot();
  }

  getMetrics() {
    const latestDriftAlerts = [];
    this.latestReplayByName.forEach((report) => {
      const alerts =
        report && report.summary && Array.isArray(report.summary.drift_alerts)
          ? report.summary.drift_alerts
          : [];
      alerts.forEach((alert) => {
        latestDriftAlerts.push({
          replay_name: report.replay_name,
          ...alert
        });
      });
    });
    return {
      queue: this.queue.getQueueSnapshot(),
      metrics: this.queue.getMetricsSummary(),
      replay_drift_alerts: latestDriftAlerts
    };
  }

  getReviewPayload(jobId) {
    return this.queue.getReviewPayload(jobId);
  }

  async getState() {
    let connectivityOk = false;
    try {
      await this.chatmockClient.health();
      connectivityOk = true;
    } catch (_error) {
      connectivityOk = false;
    }
    const queueSnapshot = this.queue.getQueueSnapshot();
    const metricsSummary = this.queue.getMetricsSummary();
    return resolveSidecarState({
      now: Date.now(),
      connectivityOk,
      signals: queueSnapshot.signals || {},
      queueSnapshot,
      metricsSummary
    });
  }

  async runReplay(payload) {
    const report = await this.replayHarness.run({
      replayName: payload.replayName,
      baselineModel: payload.baselineModel,
      candidateModel: payload.candidateModel,
      cases: payload.cases
    });
    this.latestReplayReports.set(report.replay_id, report);
    this.latestReplayByName.set(report.replay_name, report);
    return report;
  }

  getReplayReport(replayId) {
    return this.latestReplayReports.get(replayId) || null;
  }
}

module.exports = {
  AsyncControlPlane
};
