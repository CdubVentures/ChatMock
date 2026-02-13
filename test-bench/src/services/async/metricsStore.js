class MetricsStore {
  constructor({ maxLatencySamples = 500 } = {}) {
    this.maxLatencySamples = Math.max(50, Number(maxLatencySamples) || 500);
    this.totalSubmitted = 0;
    this.totalCompleted = 0;
    this.totalFailed = 0;
    this.totalCancelled = 0;
    this.byModel = new Map();
    this.errorTaxonomy = new Map();
    this.latency = {
      queue_wait_ms: [],
      model_ms: [],
      total_ms: []
    };
    this.aggressive = {
      triggered: 0,
      improved: 0,
      byFallbackReason: new Map()
    };
    this.lastErrorAt = null;
  }

  recordSubmitted(requestMeta) {
    this.totalSubmitted += 1;
    const model = requestMeta && requestMeta.model ? requestMeta.model : "unknown";
    const entry = this.byModel.get(model) || { success: 0, failure: 0 };
    this.byModel.set(model, entry);
    if (requestMeta && requestMeta.aggressive && requestMeta.aggressive.enabled) {
      this.aggressive.triggered += 1;
      const reason = requestMeta.aggressive.fallbackReason || "unspecified";
      const entry = this.aggressive.byFallbackReason.get(reason) || { triggered: 0, improved: 0 };
      entry.triggered += 1;
      this.aggressive.byFallbackReason.set(reason, entry);
    }
  }

  recordCompleted(envelope) {
    this.totalCompleted += 1;
    const model = envelope && envelope.request && envelope.request.model ? envelope.request.model : "unknown";
    const entry = this.byModel.get(model) || { success: 0, failure: 0 };
    entry.success += 1;
    this.byModel.set(model, entry);

    const latency = envelope && envelope.result && envelope.result.diagnostics && envelope.result.diagnostics.latency
      ? envelope.result.diagnostics.latency
      : {};
    this.#pushLatency("queue_wait_ms", latency.queue_wait_ms);
    this.#pushLatency("model_ms", latency.model_ms);
    this.#pushLatency("total_ms", latency.total_ms);

    const aggr = envelope && envelope.result && envelope.result.diagnostics && envelope.result.diagnostics.aggressive
      ? envelope.result.diagnostics.aggressive
      : {};
    if (aggr.enabled && Number(aggr.confidence_delta) > 0) {
      this.aggressive.improved += 1;
      const reason = aggr.fallback_reason || "unspecified";
      const entry = this.aggressive.byFallbackReason.get(reason) || { triggered: 0, improved: 0 };
      entry.improved += 1;
      this.aggressive.byFallbackReason.set(reason, entry);
    }
  }

  recordFailed(envelope) {
    this.totalFailed += 1;
    this.lastErrorAt = new Date().toISOString();
    const model = envelope && envelope.request && envelope.request.model ? envelope.request.model : "unknown";
    const entry = this.byModel.get(model) || { success: 0, failure: 0 };
    entry.failure += 1;
    this.byModel.set(model, entry);

    const code = envelope && envelope.error && envelope.error.code ? envelope.error.code : "UNKNOWN";
    this.errorTaxonomy.set(code, (this.errorTaxonomy.get(code) || 0) + 1);
  }

  recordCancelled() {
    this.totalCancelled += 1;
  }

  getSummary() {
    const totalFinished = this.totalCompleted + this.totalFailed;
    const errorRate = totalFinished > 0 ? this.totalFailed / totalFinished : 0;
    const modelSuccessRates = {};
    this.byModel.forEach((entry, model) => {
      const done = entry.success + entry.failure;
      modelSuccessRates[model] = {
        success: entry.success,
        failure: entry.failure,
        success_rate: done > 0 ? entry.success / done : 0
      };
    });
    const errors = {};
    this.errorTaxonomy.forEach((count, code) => {
      errors[code] = count;
    });
    const aggressiveByReason = {};
    this.aggressive.byFallbackReason.forEach((entry, reason) => {
      const triggered = entry.triggered || 0;
      const improved = entry.improved || 0;
      aggressiveByReason[reason] = {
        triggered,
        improved,
        win_rate: triggered > 0 ? improved / triggered : 0
      };
    });

    return {
      totals: {
        submitted: this.totalSubmitted,
        completed: this.totalCompleted,
        failed: this.totalFailed,
        cancelled: this.totalCancelled
      },
      error_rate: errorRate,
      latency: {
        queue_wait_ms: this.#stats(this.latency.queue_wait_ms),
        model_ms: this.#stats(this.latency.model_ms),
        total_ms: this.#stats(this.latency.total_ms)
      },
      model_success_rates: modelSuccessRates,
      error_taxonomy: errors,
      aggressive: {
        triggered: this.aggressive.triggered,
        improved: this.aggressive.improved,
        win_rate:
          this.aggressive.triggered > 0
            ? this.aggressive.improved / this.aggressive.triggered
            : 0,
        by_fallback_reason: aggressiveByReason
      },
      last_error_at: this.lastErrorAt
    };
  }

  #pushLatency(key, value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return;
    }
    const arr = this.latency[key];
    arr.push(parsed);
    if (arr.length > this.maxLatencySamples) {
      arr.splice(0, arr.length - this.maxLatencySamples);
    }
  }

  #stats(arr) {
    if (!Array.isArray(arr) || arr.length === 0) {
      return { count: 0, p50: null, p95: null, mean: null };
    }
    const sorted = [...arr].sort((a, b) => a - b);
    const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
    const sum = sorted.reduce((acc, n) => acc + n, 0);
    return {
      count: sorted.length,
      p50: pick(0.5),
      p95: pick(0.95),
      mean: Number((sum / sorted.length).toFixed(3))
    };
  }
}

module.exports = {
  MetricsStore
};
