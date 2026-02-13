const { EventEmitter } = require("events");
const { formatAssistantOutput } = require("../responseFormatter");
const { buildStructuredEnvelope, buildReviewPayload } = require("./envelopeBuilder");
const { MetricsStore } = require("./metricsStore");
const { ERROR_CODES, classifyError } = require("./errorCodes");

const FINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);
const PRIORITIES = ["interactive", "retry", "batch"];

function nowIso() {
  return new Date().toISOString();
}

function toPriority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (PRIORITIES.includes(normalized)) {
    return normalized;
  }
  return "batch";
}

function makeErrorWithCode(code, message) {
  const err = new Error(message ? `${code}: ${message}` : code);
  err.code = code;
  return err;
}

class AsyncQueueManager extends EventEmitter {
  constructor({
    client,
    maxInFlight = 1,
    maxQueueDepth = 100,
    retryPolicy = {},
    cooldowns = {},
    metricsStore = null
  }) {
    super();
    if (!client || typeof client.chatCompletions !== "function") {
      throw new Error("AsyncQueueManager requires client.chatCompletions");
    }
    this.client = client;
    this.maxInFlight = Math.max(1, Number(maxInFlight) || 1);
    this.maxQueueDepth = Math.max(1, Number(maxQueueDepth) || 100);
    this.retryPolicy = {
      maxAttempts: Math.max(1, Number(retryPolicy.maxAttempts) || 2),
      baseDelayMs: Math.max(0, Number(retryPolicy.baseDelayMs) || 1500),
      maxDelayMs: Math.max(100, Number(retryPolicy.maxDelayMs) || 45000)
    };
    this.cooldowns = {
      authRequiredMs: Math.max(1000, Number(cooldowns.authRequiredMs) || 300000),
      challengeMs: Math.max(1000, Number(cooldowns.challengeMs) || 90000),
      rateLimitedMs: Math.max(1000, Number(cooldowns.rateLimitedMs) || 45000),
      degradedMs: Math.max(1000, Number(cooldowns.degradedMs) || 15000)
    };

    this.metrics = metricsStore || new MetricsStore();
    this.signals = {
      auth_required_until: 0,
      challenge_until: 0,
      rate_limited_until: 0,
      degraded_until: 0
    };

    this.lanes = {
      interactive: [],
      retry: [],
      batch: []
    };
    this.running = new Map();
    this.jobs = new Map();
    this.results = new Map();
    this.jobSeq = 0;
    this.drainScheduled = false;
  }

  submit(request) {
    const payload = request && request.payload ? request.payload : null;
    if (!payload || typeof payload !== "object") {
      throw makeErrorWithCode(ERROR_CODES.INVALID_REQUEST, "payload is required");
    }
    if (!payload.model || !Array.isArray(payload.messages)) {
      throw makeErrorWithCode(ERROR_CODES.INVALID_REQUEST, "payload.model and payload.messages are required");
    }
    if (this.#totalDepth() >= this.maxQueueDepth) {
      throw makeErrorWithCode(ERROR_CODES.QUEUE_BACKPRESSURE, "Queue backpressure: queue is full");
    }

    const priority = toPriority(request.priority);
    const jobId = `job-${Date.now()}-${++this.jobSeq}`;
    const queuedAtMs = Date.now();
    const job = {
      job_id: jobId,
      payload,
      priority,
      status: "queued",
      attempts: 0,
      queuedAtMs,
      queuedAt: new Date(queuedAtMs).toISOString(),
      startedAt: null,
      completedAt: null,
      requestMeta: {
        model: payload.model,
        priority,
        aggressive: {
          enabled: Boolean(request && request.aggressive && request.aggressive.enabled),
          fallbackReason:
            request && request.aggressive && typeof request.aggressive.fallbackReason === "string"
              ? request.aggressive.fallbackReason
              : null,
          confidenceBefore:
            request && request.aggressive && Number.isFinite(Number(request.aggressive.confidenceBefore))
              ? Number(request.aggressive.confidenceBefore)
              : null
        },
        domAnchor: request && request.domAnchor ? request.domAnchor : null,
        screenshotRegion: request && request.screenshotRegion ? request.screenshotRegion : null,
        reasoningNote: request && request.reasoningNote ? request.reasoningNote : null
      },
      waiters: [],
      cancelRequested: false,
      abortController: null
    };
    this.jobs.set(jobId, job);
    this.lanes[priority].push(jobId);
    this.metrics.recordSubmitted(job.requestMeta);
    this.#scheduleDrain();

    return {
      job_id: jobId,
      status: job.status,
      links: {
        status: `/api/async/status/${jobId}`,
        result: `/api/async/result/${jobId}`,
        cancel: `/api/async/cancel/${jobId}`
      }
    };
  }

  cancel(jobId) {
    const job = this.jobs.get(jobId);
    if (!job && !this.results.has(jobId)) {
      return { cancelled: false, code: ERROR_CODES.JOB_NOT_FOUND, message: "Job not found." };
    }
    if (this.results.has(jobId)) {
      return { cancelled: false, code: "ALREADY_FINAL", message: "Job is already final." };
    }

    if (this.running.has(jobId)) {
      const running = this.running.get(jobId);
      running.cancelRequested = true;
      if (running.abortController) {
        try {
          running.abortController.abort();
        } catch (_error) {
          // no-op
        }
      }
      return { cancelled: true, running: true, job_id: jobId, status: "cancel_requested" };
    }

    this.#removeFromLanes(jobId);
    job.status = "cancelled";
    const completedAt = nowIso();
    const envelope = buildStructuredEnvelope({
      jobId: job.job_id,
      status: "cancelled",
      requestMeta: job.requestMeta,
      rawResponse: null,
      formatted: {
        assistantText: "",
        parsedJson: null,
        renderedHtml: "",
        mode: "markdown"
      },
      error: {
        code: ERROR_CODES.JOB_CANCELLED,
        message: "Job cancelled before execution.",
        retryable: false,
        status: 409
      },
      timings: {
        queuedAt: job.queuedAt,
        startedAt: null,
        completedAt,
        queueWaitMs: null,
        modelTimeMs: null,
        totalMs: Date.now() - job.queuedAtMs
      },
      attempts: job.attempts
    });
    this.metrics.recordCancelled();
    this.#finalize(job, envelope);
    return { cancelled: true, running: false, job_id: jobId, status: "cancelled" };
  }

  getStatus(jobId) {
    if (this.results.has(jobId)) {
      const result = this.results.get(jobId);
      return {
        job_id: jobId,
        status: result.status,
        timings: result.timings || null,
        error: result.error || null
      };
    }
    const job = this.jobs.get(jobId);
    if (!job) {
      return null;
    }
    return {
      job_id: jobId,
      status: job.status,
      attempts: job.attempts,
      priority: job.priority,
      queued_at: job.queuedAt,
      started_at: job.startedAt
    };
  }

  getResult(jobId) {
    return this.results.get(jobId) || null;
  }

  async waitForCompletion(jobId, timeoutMs = 600000) {
    const done = this.getResult(jobId);
    if (done) {
      return done;
    }
    const job = this.jobs.get(jobId);
    if (!job) {
      throw makeErrorWithCode(ERROR_CODES.JOB_NOT_FOUND, "Job not found");
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(makeErrorWithCode(ERROR_CODES.UPSTREAM_TIMEOUT, `Timed out waiting for job ${jobId}`));
      }, Math.max(1, Number(timeoutMs) || 1));
      job.waiters.push((envelope) => {
        clearTimeout(timer);
        resolve(envelope);
      });
    });
  }

  async runInlineJob(request, timeoutMs) {
    const submitted = this.submit(request);
    return this.waitForCompletion(submitted.job_id, timeoutMs);
  }

  getQueueSnapshot() {
    const byPriority = {};
    PRIORITIES.forEach((p) => {
      byPriority[p] = this.lanes[p].length;
    });
    return {
      max_in_flight: this.maxInFlight,
      max_queue_depth: this.maxQueueDepth,
      running: this.running.size,
      depth: {
        total: this.#totalDepth(),
        by_priority: byPriority
      },
      signals: { ...this.signals }
    };
  }

  getMetricsSummary() {
    return this.metrics.getSummary();
  }

  getReviewPayload(jobId) {
    const envelope = this.getResult(jobId);
    if (!envelope) {
      return null;
    }
    return buildReviewPayload(envelope);
  }

  #removeFromLanes(jobId) {
    PRIORITIES.forEach((priority) => {
      const idx = this.lanes[priority].indexOf(jobId);
      if (idx >= 0) {
        this.lanes[priority].splice(idx, 1);
      }
    });
  }

  #totalDepth() {
    return this.running.size + this.lanes.interactive.length + this.lanes.retry.length + this.lanes.batch.length;
  }

  #scheduleDrain() {
    if (this.drainScheduled) {
      return;
    }
    this.drainScheduled = true;
    setImmediate(() => {
      this.drainScheduled = false;
      this.#drain().catch(() => {
        // avoid unhandled
      });
    });
  }

  #pickNextJobId() {
    for (const lane of PRIORITIES) {
      if (this.lanes[lane].length > 0) {
        return this.lanes[lane].shift();
      }
    }
    return null;
  }

  #cooldownUntil() {
    return Math.max(
      Number(this.signals.auth_required_until || 0),
      Number(this.signals.challenge_until || 0),
      Number(this.signals.rate_limited_until || 0),
      Number(this.signals.degraded_until || 0)
    );
  }

  async #drain() {
    const now = Date.now();
    const cooldownUntil = this.#cooldownUntil();
    if (cooldownUntil > now) {
      const wait = Math.max(50, cooldownUntil - now);
      setTimeout(() => this.#scheduleDrain(), wait);
      return;
    }

    while (this.running.size < this.maxInFlight) {
      const nextId = this.#pickNextJobId();
      if (!nextId) {
        break;
      }
      const job = this.jobs.get(nextId);
      if (!job || FINAL_STATUSES.has(job.status)) {
        continue;
      }
      this.#startJob(job);
    }
  }

  #startJob(job) {
    const startedAtMs = Date.now();
    job.status = "running";
    job.startedAt = new Date(startedAtMs).toISOString();
    job.attempts += 1;
    job.abortController = typeof AbortController !== "undefined" ? new AbortController() : null;
    this.running.set(job.job_id, job);

    const run = async () => {
      let envelope = null;
      try {
        const rawResponse = await this.client.chatCompletions(
          job.payload,
          null,
          { signal: job.abortController ? job.abortController.signal : undefined }
        );
        const formatted = formatAssistantOutput(rawResponse);
        const completedAtMs = Date.now();
        envelope = buildStructuredEnvelope({
          jobId: job.job_id,
          status: "completed",
          requestMeta: job.requestMeta,
          rawResponse,
          formatted,
          error: null,
          timings: {
            queuedAt: job.queuedAt,
            startedAt: job.startedAt,
            completedAt: new Date(completedAtMs).toISOString(),
            queueWaitMs: startedAtMs - job.queuedAtMs,
            modelTimeMs: completedAtMs - startedAtMs,
            totalMs: completedAtMs - job.queuedAtMs
          },
          attempts: job.attempts
        });
        this.metrics.recordCompleted(envelope);
        this.#finalize(job, envelope);
      } catch (error) {
        const classified = classifyError(error);
        this.#applySignal(classified.code);

        const shouldRetry =
          classified.retryable &&
          !job.cancelRequested &&
          job.attempts < this.retryPolicy.maxAttempts;

        if (job.cancelRequested) {
          const completedAtMs = Date.now();
          envelope = buildStructuredEnvelope({
            jobId: job.job_id,
            status: "cancelled",
            requestMeta: job.requestMeta,
            rawResponse: null,
            formatted: {
              assistantText: "",
              parsedJson: null,
              renderedHtml: "",
              mode: "markdown"
            },
            error: {
              code: ERROR_CODES.JOB_CANCELLED,
              message: "Job cancelled while running.",
              retryable: false,
              status: 409
            },
            timings: {
              queuedAt: job.queuedAt,
              startedAt: job.startedAt,
              completedAt: new Date(completedAtMs).toISOString(),
              queueWaitMs: startedAtMs - job.queuedAtMs,
              modelTimeMs: completedAtMs - startedAtMs,
              totalMs: completedAtMs - job.queuedAtMs
            },
            attempts: job.attempts
          });
          this.metrics.recordCancelled();
          this.#finalize(job, envelope);
          return;
        }

        if (shouldRetry) {
          job.status = "retrying";
          const delay = Math.min(
            this.retryPolicy.maxDelayMs,
            this.retryPolicy.baseDelayMs * Math.pow(2, Math.max(0, job.attempts - 1))
          );
          setTimeout(() => {
            if (FINAL_STATUSES.has(job.status)) {
              return;
            }
            job.status = "queued";
            this.lanes.retry.push(job.job_id);
            this.#scheduleDrain();
          }, delay);
          return;
        }

        const completedAtMs = Date.now();
        envelope = buildStructuredEnvelope({
          jobId: job.job_id,
          status: "failed",
          requestMeta: job.requestMeta,
          rawResponse: null,
          formatted: {
            assistantText: "",
            parsedJson: null,
            renderedHtml: "",
            mode: "markdown"
          },
          error: {
            code: classified.code,
            message: classified.message,
            retryable: classified.retryable,
            status: classified.status
          },
          timings: {
            queuedAt: job.queuedAt,
            startedAt: job.startedAt,
            completedAt: new Date(completedAtMs).toISOString(),
            queueWaitMs: startedAtMs - job.queuedAtMs,
            modelTimeMs: completedAtMs - startedAtMs,
            totalMs: completedAtMs - job.queuedAtMs
          },
          attempts: job.attempts
        });
        this.metrics.recordFailed(envelope);
        this.#finalize(job, envelope);
      } finally {
        this.running.delete(job.job_id);
        job.abortController = null;
        this.#scheduleDrain();
      }
    };
    run().catch(() => {
      // no-op
    });
  }

  #applySignal(errorCode) {
    const now = Date.now();
    if (errorCode === ERROR_CODES.UPSTREAM_LOGIN_REQUIRED) {
      this.signals.auth_required_until = now + this.cooldowns.authRequiredMs;
      return;
    }
    if (errorCode === ERROR_CODES.UPSTREAM_CHALLENGE) {
      this.signals.challenge_until = now + this.cooldowns.challengeMs;
      return;
    }
    if (errorCode === ERROR_CODES.UPSTREAM_RATE_LIMITED) {
      this.signals.rate_limited_until = now + this.cooldowns.rateLimitedMs;
      return;
    }
    if (errorCode === ERROR_CODES.UPSTREAM_UNAVAILABLE) {
      this.signals.degraded_until = now + this.cooldowns.degradedMs;
    }
  }

  #finalize(job, envelope) {
    job.status = envelope.status;
    job.completedAt = envelope.timings && envelope.timings.completed_at ? envelope.timings.completed_at : nowIso();
    this.results.set(job.job_id, envelope);
    const waiters = Array.isArray(job.waiters) ? [...job.waiters] : [];
    job.waiters = [];
    waiters.forEach((fn) => {
      try {
        fn(envelope);
      } catch (_error) {
        // no-op
      }
    });
    this.emit("job.final", envelope);
  }
}

module.exports = {
  AsyncQueueManager
};
